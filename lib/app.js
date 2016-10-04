/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

var mod_assert = require('assert-plus');
var mod_restify = require('restify');
var mod_os = require('os');
var mod_vmapi = require('sdc-clients').VMAPI;
var mod_napi = require('sdc-clients').NAPI;
var mod_changefeed = require('changefeed');

var lib_common = require('./common');
var lib_endpointsMetrics = require('./endpoints/metrics');
var lib_updater = require('./updater');
var lib_bootstrapper = require('./bootstrapper');

var HOSTNAME = mod_os.hostname();

function App(opts) {
    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.config, 'opts.config');
    mod_assert.object(opts.log, 'opts.log');

    var self = this;
    self.config = opts.config;
    self.log = opts.log;
    self.vmapi = new mod_vmapi(
        {
            url: self.config.vmapi.url,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: opts.log,
            agent: false
        });
    self.napi = new mod_napi(
        {
            url: self.config.napi.url,
            retry: {
                retries: 1,
                minTimeout: 1000
            },
            log: opts.log,
            agent: false
        });
    self.cache = { vms: {}, ips: {} };

    var changefeedOpts = {
        log: self.log,
        url: self.config.vmapi.url,
        instance: self.config.changefeed_opts.instance,
        service: 'cmon',
        changeKind: {
            resource: self.config.changefeed_opts.resource,
            subResources: self.config.changefeed_opts.subResources
        },
        backoff: {
            maxTimeout: Infinity,
            minTimeout: 10,
            retries: Infinity
        }
    };

    var cfListener = mod_changefeed.createListener(changefeedOpts);
    var bootstrapper = new lib_bootstrapper({ app: self });
    var updater = new lib_updater({ app: self });

    cfListener.on('bootstrap', function () {
        bootstrapper.start();
        bootstrapper.pipe(updater);
    });

    cfListener.on('error', function () {
        mod_assert.fail('cfListener fail!');
    });

    var server = self.server = mod_restify.createServer({
        name: 'cmon',
        log: self.log,
        handleUpgrades: false
        // TODO: tls config
    });

    server.use(function basicResReq(req, res, next) {
        // TODO: Richard, not sure if you want all these. Re 'x-' prefixes, I'd
        //      actually advocate for dropping the prefix, but I don't know if
        //      that'd be incompat with any tooling we have.
        res.on('header', function onHeader() {
            var now = Date.now();
            res.header('Date', new Date());
            res.header('Server', server.name);
            res.header('x-request-id', req.getId());
            var t = now - req.time();
            res.header('x-response-time', t);
            res.header('x-server-name', HOSTNAME);
        });

        req.app = self;
        next();
    });

    server.use(mod_restify.requestLogger());
    server.on('uncaughtException', lib_common.uncaughtHandler);

    // TODO: trace evt logging a la the other APIs?

    server.on('after', function audit(req, res, route, err) {
        // Successful GET res bodies are uninteresting and *big*.
        var body = !(req.method === 'GET' &&
            Math.floor(res.statusCode / 100) === 2);

        mod_restify.auditLogger({
            log: req.log.child(
                {
                    route: route && route.name,
                    action: req.query.action
                },
                true),
            body: body
        })(req, res, route, err);
    });

    lib_endpointsMetrics.mount({server: server});
}

App.prototype.start = function _start(cb) {
    var self = this;
    self.server.listen(this.config.port, this.config.address, function () {
        self.log.info({url: self.server.url}, 'listening');
        cb();
    });
};

App.prototype.close = function _close(cb) {
    var self = this;
    self.server.on('close', function () {
        cb();
    });
    self.server.close();
};

module.exports = App;

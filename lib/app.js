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

var lib_common = require('./common');
var lib_endpointsMetrics = require('./endpoints/metrics');

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

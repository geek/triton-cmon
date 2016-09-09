/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var mod_bunyan = require('bunyan');
var mod_restify = require('restify');

function Server(config) {
    // TODO: Setup stuffs from the config here
    var self = this;
    self.config = config;
    self.log = new mod_bunyan({
        name: 'Metric Agent Proxy',
        level: config.logLevel,
        serializers: {
            err: mod_bunyan.stdSerializers.err,
            req: mod_bunyan.stdSerializers.req,
            res: mod_bunyan.stdSerializers.res
        }
    });

    self.log.info({ config: config }, 'Metric Agent Proxy config');
    self.config.log = self.log;
}

Server.prototype.start = function start() {
    var self = this;
    // TODO: See if this is right
    // self.start_timestamp = (new Date()).toISOString();

    var map = mod_restify.createServer({
        name: 'Metric Agent Proxy',
        log: self.log,
        handleUpgrades: false
    });

    map.listen(self.config.api.port, function () {
        self.log.info('% listening at %s', map.name, map.url);
    });

    map.get({
        name: 'metrics',
        path: '/metrics'
    }, function _metrics(req, res, next) {
        self.log.error(req);
        res.send('poop');
        return next();
    });
};

module.exports = Server;

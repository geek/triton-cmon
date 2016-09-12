/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

'use strict';

var mod_assert = require('assert-plus');
var mod_bunyan = require('bunyan');
var mod_fs = require('fs');
var mod_path = require('path');
var mod_restify = require('restify');
var mod_vasync = require('vasync');
var VError = require('verror').VError;

var App = require('../lib/app');


// ---- globals

var CONFIG_PATH = mod_path.resolve(__dirname, '..', 'etc', 'config.json');

var log = mod_bunyan.createLogger({
    name: 'cmon',
    serializers: mod_restify.bunyan.serializers
});


// ---- internal support

function loadConfig(cb) {
    mod_assert.func(cb, 'cb');

    log.debug({CONFIG_PATH: CONFIG_PATH}, 'loadConfig');
    mod_fs.readFile(CONFIG_PATH, {encoding: 'utf8'}, function (err, data) {
        if (err) {
            cb(err);
        } else {
            try {
                cb(null, JSON.parse(data));
            } catch (parseErr) {
                cb(VError(parseErr, 'could not parse ' + CONFIG_PATH));
            }
        }
    });
}


// ---- mainline

function main() {
    mod_vasync.pipeline({arg: {}, funcs: [
        function getConfigAndSetupLogging(arg, next) {
            loadConfig(function (err, config) {
                if (err) {
                    next(err);
                    return;
                }

                arg.config = config;
                if (config.logLevel) {
                    log.level(config.logLevel);
                }
                if (log.level() <= mod_bunyan.TRACE) {
                    log.src = true;
                }
                log.debug({config: arg.config}, 'loaded config');
                next();
            });
        },

        function createAndStartApp(arg, next) {
            var app = new App({config: arg.config, log: log});
            app.start(next);
        }

        // TODO: want setupSignalHandlers a la imgapi/main.js?
    ]}, function (err) {
        if (err) {
            log.error(err, 'error starting up');
            process.exit(2);
        }
        log.info('startup complete');
    });

}

main();
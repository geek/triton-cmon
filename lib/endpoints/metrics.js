/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

var mod_assert = require('assert-plus');

function apiGetMetrics(req, res, next) {
    res.send('hello world');
    next();
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');

    opts.server.get({name: 'GetMetrics', path: '/metrics'}, apiGetMetrics);
}

module.exports = {
    mount: mount
};

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
var mod_vasync = require('vasync');

var lib_errors = require('../errors');

function apiGetContainers(req, res, next) {
    var cache = req.app.cache;

    mod_assert.object(cache, 'cache object');
    mod_assert.uuid(req.account.uuid, 'account uuid');
    var account_uuid = req.account.uuid;
    var account_is_cached = cache.owners.has(account_uuid);
    if (account_is_cached && cache.owners.get(account_uuid).vms.size != 0) {
        var accountVms = cache.owners.get(account_uuid).vms;
        var resObj = { containers: Array.from(accountVms.keys()) };
        res.send(resObj);
        next();
    } else {
        next(new lib_errors.NotFoundError());
    }
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');
    opts.server.get(
        {
            name: 'GetContainers',
            path: '/discover'
        }, apiGetContainers);
}

module.exports = { mount: mount };

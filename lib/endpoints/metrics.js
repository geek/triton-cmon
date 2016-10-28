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

function apiGetMetrics(req, res, next) {
    var vm_uuid = req.header('HOST').split('.')[0];
    var cache = req.app.cache;

    mod_assert.object(cache, 'cache object');
    mod_assert.object(cache.vms, 'cache.vms object');
    mod_assert.object(cache.admin_ips, 'cache.nics object');

    if (!cache.vms[vm_uuid]) {
        req.log.error({ vm_cache: cache, z_uuid: vm_uuid }, 'hmmm');
        res.header('content-type', 'text/plain');
        res.statusCode = 404;
        next();
    } else {
        var server_uuid = cache.vms[vm_uuid];
        mod_assert.string(server_uuid, 'server_uuid');

        var admin_ip = cache.admin_ips[server_uuid];
        mod_assert.string(admin_ip, 'admin_ip');

        var cmon_agent_url = 'http://' + admin_ip + ':9163';
        var cmon_agent_path = '/' + vm_uuid + '/metrics';
        var client = mod_restify.createStringClient({ url: cmon_agent_url });
        client.get(cmon_agent_path, function (err, req2, res2, data2) {
            mod_assert.ifError(err);
            res.header('content-type', 'text/plain');
            res.send(data2);
            next();
        });
    }
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');
    opts.server.get({name: 'GetMetrics', path: '/metrics'}, apiGetMetrics);
}

module.exports = {
    mount: mount
};

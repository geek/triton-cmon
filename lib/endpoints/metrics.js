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
    var vmapi = req.app.vmapi;
    var napi = req.app.napi;
    var vm_uuid = req.header('HOST').split('.')[0];

    mod_vasync.pipeline({
        arg: {},
        funcs: [
            function getVmFromVMAPI(arg, cb) {
                vmapi.getVm({uuid: vm_uuid }, function (err, vm) {
                    mod_assert.ifError(err, 'Error fetching VM details');
                    arg.vm = vm;
                    cb();
                });
            },
            function getIpFromNAPI(arg, cb) {
                napi.listNics(
                {
                    belongs_to_uuid: arg.vm.server_uuid,
                    belongs_to_type: 'server',
                    nic_tags_provided: 'admin'
                }, function (err, nics) {
                    mod_assert.ifError(err, 'Error fetching nics');
                    arg.nics = nics;
                    cb();
                });
            },
            function getAgentMetrics(arg, cb) {
                var cmon_agent_url = 'http://' + arg.nics[0].ip + ':9163';
                var cmon_agent_path = '/' + vm_uuid + '/metrics';
                var client = mod_restify.createStringClient({
                    url: cmon_agent_url
                });
                client.get(cmon_agent_path, function (err, req2, res2, data2) {
                    mod_assert.ifError(err);
                    res2.header('content-type', 'text/plain');
                    res2.send(data2);
                    cb();
                });
            }
        ]
    }, function (err) {
        mod_assert.ifError(err, 'Failure proxying metrics');
        next();
    });
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');

    opts.server.get({name: 'GetMetrics', path: '/metrics'}, apiGetMetrics);
}

module.exports = {
    mount: mount
};

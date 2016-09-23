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

function apiGetMetrics(req, res, next) {
    var vmapi = req.app.vmapi;
    var napi = req.app.napi;
    var vm_uuid = req.header('HOST').split('.')[0];
    vmapi.getVm({uuid: vm_uuid },
        function (err, vm) {
            napi.listNics(
                {
                    belongs_to_uuid: vm.server_uuid,
                    belongs_to_type: 'server',
                    nic_tags_provided: 'admin'
                },
                function (err2, nics) {
                    var cmon_agent_url = 'http://' + nics[0].ip + ':9163';
                    var cmon_agent_path = '/' + vm_uuid + '/metrics';
                    var client = mod_restify.createStringClient({
                        url: cmon_agent_url
                    });

                    client.get(cmon_agent_path,
                        function (err3, req2, res2, data) {
                            mod_assert.ifError(err3);
                            res.header('content-type', 'text/plain');
                            res.send(data);
                    });
            });
    });

//    res.send('hello world');
    next();
}

function mount(opts) {
    mod_assert.object(opts.server, 'opts.server');

    opts.server.get({name: 'GetMetrics', path: '/metrics'}, apiGetMetrics);
}

module.exports = {
    mount: mount
};

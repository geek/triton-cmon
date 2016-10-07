/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2016, Joyent, Inc.
 */

var mod_stream = require('stream');
var mod_util = require('util');

var mod_assert = require('assert-plus');
var mod_vasync = require('vasync');

function Updater(opts) {
    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.app, 'opts.app');
    mod_assert.object(opts.app.log, 'opts.app.log');
    mod_assert.object(opts.app.vmapi, 'opts.app.vmapi');
    mod_assert.object(opts.app.napi, 'opts.app.napi');
    mod_assert.object(opts.app.cache, 'opts.app.cache');

    this.log = opts.app.log;
    this.vmapi = opts.app.vmapi;
    this.napi = opts.app.napi;
    this.cache = opts.app.cache;

    mod_stream.Writable.call(this, { objectMode: true });
}
mod_util.inherits(Updater, mod_stream.Writable);

Updater.prototype._write = function (chunk, encoding, cb) {
    var log = this.log;
    log.trace('_write: start');
    var cache = this.cache;
    var vmapi = this.vmapi;
    var napi = this.napi;

    function handleBootstrapperChunk(bsChunk, bsArg, bsCb) {
        bsArg.vm_uuid = bsChunk.vm_uuid;
        bsArg.server_uuid = bsChunk.server_uuid;
        cache.vms[bsArg.vm_uuid] = bsArg.server_uuid;
        bsCb();
    }

    function handleChangefeedChunk(cfChunk, cfArg, cfCb) {
        cfArg.vm_uuid = cfChunk.changedResourceId;
        vmapi.getVm({ uuid: cfArg.vm_uuid }, function (vmErr, vm) {
            if (!vmErr) {
                cfArg.server_uuid = cache.vms[cfArg.vm_uuid] = vm.server_uuid;
            } else if (vmErr.statusCode === 404) {
                cfArg.server_uuid = vm.server_uuid;
                delete (cache.vms[cfArg.vm_uuid]);
            } else {
                mod_assert.ifError(vmErr, 'Error fetching VM');
            }

            cfCb();
        });
    }

    mod_vasync.pipeline({
        arg: {},
        funcs: [
            function updateVmCache(arg, next) {
                if (chunk.source && chunk.source === 'Bootstrapper') {
                    handleBootstrapperChunk(chunk, arg, next);
                } else {
                    handleChangefeedChunk(chunk, arg, next);
                }
            },
            function updateAdminIpCache(arg, next) {
                var napiArgs =
                {
                    belongs_to_uuid: arg.server_uuid,
                    belongs_to_type: 'server',
                    nic_tags_provided: 'admin'
                };

                napi.listNics(napiArgs, function (nicErr, nics) {
                    if (!nicErr) {
                        cache.admin_ips[arg.server_uuid] = arg.ip = nics[0].ip;
                    } else if (nicErr.statusCode === 404) {
                        delete (cache.admin_ips[arg.server_uuid]);
                    } else {
                        mod_assert.ifError(nicErr, 'Error fetching nics');
                    }

                    next();
                });
            }
        ]
    },
    function (err) {
        mod_assert.ifError(err, 'Failure updating cache');
        cb();
    });
};

module.exports = Updater;

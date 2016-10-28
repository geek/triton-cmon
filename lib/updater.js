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
    mod_stream.Writable.call(this, { objectMode: true });

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

}
mod_util.inherits(Updater, mod_stream.Writable);

Updater.prototype._handleBsChunk = function (bs_chunk, bs_vm, bs_cb) {
    var cache = this.cache;
    mod_assert.object(cache);
    bs_vm.vm_uuid = bs_chunk.vm_uuid;
    bs_vm.server_uuid = bs_chunk.server_uuid;
    cache.vms[bs_vm.vm_uuid] = bs_vm.server_uuid;
    this.log.debug(
        {
            vm: bs_vm.vm_uuid,
            server: bs_vm.server_uuid
        },
        'Cached by bootstrap');
    bs_cb();
};

Updater.prototype._handleCfChunk = function (cf_chunk, cf_vm, cf_cb) {
    var vmapi = this.vmapi;
    var cache = this.cache;
    cf_vm.vm_uuid = cf_chunk.changedResourceId;
    vmapi.getVm({ uuid: cf_vm.vm_uuid }, function (vmErr, vm) {
        if (!vmErr) {
            cf_vm.server_uuid = cache.vms[cf_vm.vm_uuid] = vm.server_uuid;
            this.log.trace(
                {
                    vm_uuid: cf_vm.vm_uuid,
                    server_uuid: cf_vm.server_uuid
                },
                'Cached on cf event');
        } else if (vmErr.statusCode === 404) {
            cf_vm.server_uuid = vm.server_uuid;
            delete (cache.vms[cf_vm.vm_uuid]);
            this.log.trace(
                {
                    vm_uuid: cf_vm.vm_uuid,
                    server_uuid: cf_vm.server_uuid
                },
                'Deleted on cf event and VMAPI 404');
        } else {
            mod_assert.ifError(vmErr, 'Error fetching VM');
        }
        cf_cb();
    });
};

Updater.prototype._write = function (chunk, encoding, cb) {
    var self = this;
    var log = self.log;
    log.trace('_write: start');
    var cache = self.cache;
    var napi = self.napi;

    self.log.debug({ item: chunk }, 'Item to process');

    mod_vasync.pipeline({
        arg: {},
        funcs: [
            function updateVmCache(arg, next) {
                if (chunk.source && chunk.source === 'Bootstrapper') {
                    self._handleBsChunk(chunk, arg, next);
                } else {
                    self._handleCfChunk(chunk, arg, next);
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

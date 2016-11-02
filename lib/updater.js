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
    mod_stream.Writable.call(this, { objectMode: true, highWaterMark: 16});

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

Updater.prototype._handleBsChunk = function (bs_chunk, bs_arg, bs_cb) {
    var self = this;
    var cache = self.cache;

    mod_assert.object(cache);
    mod_assert.uuid(bs_chunk.vm_uuid);
    mod_assert.uuid(bs_chunk.vm_owner_uuid);
    mod_assert.uuid(bs_chunk.server_uuid);

    var owner_uuid = bs_chunk.vm_owner_uuid;
    var server_uuid = bs_chunk.server_uuid;
    var vm_uuid = bs_chunk.vm_uuid;

    cache.vms.set(vm_uuid, { server_uuid: server_uuid });
    bs_arg.server = cache.vms.get(vm_uuid);

    if (!cache.owners.has(owner_uuid)) {
        cache.owners.set(owner_uuid, { vms: new Map() });
    }
    var ownerVms = cache.owners.get(owner_uuid).vms;
    ownerVms.set(vm_uuid, cache.vms.get(vm_uuid));
    self.log.debug(
        {
            vm_uuid: vm_uuid,
            owner_uuid: owner_uuid,
            server_uuid: server_uuid,
            cache_vms: Array.from(cache.vms.keys()),
            cache_owners: Array.from(cache.owners.keys())
        },
        'Cached by bootstrap');
    bs_cb();
};

Updater.prototype._handleCfChunk = function (cf_chunk, cf_arg, cf_cb) {
    var self = this;
    var vmapi = self.vmapi;
    var cache = self.cache;
    var vm_uuid = cf_arg.vm_uuid = cf_chunk.changedResourceId;
    var vmapiFilter = { uuid: cf_arg.vm_uuid };
    vmapi.listVms(vmapiFilter, function (vmErr, vms) {
        mod_assert.ifError(vmErr, 'Error fetching VM');
        mod_assert.array(vms, 'vms');
        mod_assert.ok(vms.length === 1, 'vms array should always be length 1');
        var vm = vms.pop();
        if (vm.state === 'running') {
            cache.vms.set(vm_uuid, { server_uuid: vm.server_uuid });
            cf_arg.server = cache.vms.get(vm_uuid);

            if (!cache.owners.has(vm.owner_uuid)) {
                cache.owners.set(vm.owner_uuid, { vms: new Map() });
            }

            var ownerVms = cache.owners.get(vm.owner_uuid).vms;
            ownerVms.set(vm_uuid, cache.vms.get(vm_uuid));
            self.log.trace(
                {
                    vm_uuid: vm_uuid,
                    owner_uuid: cf_arg.owner_uuid,
                    server_uuid: cf_arg.server.server_uuid,
                    cache_vms: Array.from(cache.vms.keys()),
                    cache_owners: Array.from(cache.owners.keys())
                },
                'Cached on cf event');
        } else if (vm.state === 'stopped' || vm.state === 'destroyed') {
            cf_arg.server =
                {
                    server_uuid: vm.server_uuid
                };

            if (cache.vms.has(vm_uuid)) {
                cache.vms.delete(vm_uuid);
                self.log.trace(
                    {
                        vm_uuid: cf_arg.vm_uuid,
                        server_uuid: cf_arg.server_uuid
                    },
                    'Deleted vm from vms cache on cf event');
            }

            if (cache.owners.has(vm.owner_uuid)) {
                cache.owners.get(vm.owner_uuid).vms.delete(vm_uuid);
                if (cache.owners.get(vm.owner_uuid).vms.size === 0) {
                    cache.owners.delete(vm.owner_uuid);
                    self.log.trace(
                        {
                            rmOwner: vm.owner_uuid
                        },
                        'Deleted owner from owners cache on cf event');
                    }
            }
        } else {
            self.log.trace({ skippedVm: vm }, 'VM state is not relevant');
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

    log.trace({ item: chunk }, 'Item to process');

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
                if (arg && arg.server && arg.server.server_uuid) {
                    var napiArgs =
                    {
                        belongs_to_uuid: arg.server.server_uuid,
                        belongs_to_type: 'server',
                        nic_tags_provided: 'admin'
                    };

                    napi.listNics(napiArgs, function (nicErr, nics) {
                        if (!nicErr) {
                            arg.ip = nics[0].ip;
                            var server_uuid = arg.server.server_uuid;
                            cache.admin_ips.set(server_uuid,
                                {
                                    admin_ip: arg.ip
                                });
                        } else if (nicErr.statusCode === 404) {
                            cache.admin_ips.delete(server_uuid);
                            self.log.trace(
                                {
                                    server_uuid: server_uuid
                                },
                                'Deleted by NAPI 404');
                        } else {
                            mod_assert.ifError(nicErr, 'Error fetching nics');
                        }

                        next();
                    });
                } else {
                    self.log.trace('Skipping NAPI lookup');
                    next();
                }
            }
        ]
    },
    function (err) {
        mod_assert.ifError(err, 'Failure updating cache');
        cb();
    });
};

module.exports = Updater;

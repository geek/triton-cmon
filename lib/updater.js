/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2016, Joyent, Inc.
 */

var mod_assert = require('assert-plus');
var mod_backoff = require('backoff');
var mod_restify = require('restify');
var mod_stream = require('stream');
var mod_util = require('util');
var mod_vasync = require('vasync');

var lib_common = require('./common');
var lib_errors = require('./errors');

var RETRIES = 10;
var MIN_TIMEOUT = 2000;
var MAX_TIMEOUT = 10000;

function Updater(opts) {
    mod_stream.Writable.call(this, { objectMode: true, highWaterMark: 16});

    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.app, 'opts.app');
    mod_assert.object(opts.app.log, 'opts.app.log');
    mod_assert.object(opts.app.vmapi, 'opts.app.vmapi');
    mod_assert.object(opts.app.cnapi, 'opts.app.cnapi');
    mod_assert.object(opts.app.cache, 'opts.app.cache');

    this.log = opts.app.log;
    this.vmapi = opts.app.vmapi;
    this.cnapi = opts.app.cnapi;
    this.cache = opts.app.cache;

}
mod_util.inherits(Updater, mod_stream.Writable);

Updater.prototype._handleBsChunk = function (bs_chunk, bs_arg, bs_cb) {
    var self = this;
    bs_arg.server = bs_chunk;
    lib_common.cacheVm(bs_chunk, self.cache, function (err) {
        mod_assert.ifError(err);
        self.log.trace(
            {
                vm_uuid: bs_chunk.vm_uuid,
                owner_uuid: bs_chunk.owner_uuid,
                server_uuid: bs_chunk.server_uuid,
                cache_vms: Array.from(self.cache.vms.keys()),
                cache_owners: Array.from(self.cache.owners.keys())
            },
            'Cached by bootstrap');
        bs_cb();
    });
};

Updater.prototype._handleCfChunk = function (cf_chunk, cf_arg, cf_cb) {
    var self = this;
    var vmapi = self.vmapi;
    var cache = self.cache;
    var vm_uuid = cf_arg.vm_uuid = cf_chunk.changedResourceId;
    var vmapiFilter = { uuid: cf_arg.vm_uuid };
    vmapi.listVms(vmapiFilter, function (vmErr, vms) {
        // TODO: Attempt backoff before giving up completely
        mod_assert.ifError(vmErr, 'Error fetching VM');
        mod_assert.array(vms, 'vms');
        mod_assert.ok(vms.length === 1, 'vms array should always be length 1');
        var vm = vms.pop();
        if (vm.state === 'running') {
            lib_common.mapVm(vm, 'Changefeed', function (mErr, mVm) {
                mod_assert.ifError(mErr);
                lib_common.cacheVm(mVm, cache, function (cErr) {
                    mod_assert.ifError(cErr);
                    cf_arg.server = { server_uuid: vm.server_uuid };

                    self.log.trace(
                        {
                            vm_uuid: vm_uuid,
                            owner_uuid: cf_arg.owner_uuid,
                            server_uuid: cf_arg.server.server_uuid,
                            cache_vms: Array.from(cache.vms.keys()),
                            cache_owners: Array.from(cache.owners.keys())
                        },
                        'Cached on cf event');
                    cf_cb();
                    return;
                });
            });
        } else if (vm.state === 'stopped' || vm.state === 'destroyed') {
            cf_arg.server = { server_uuid: vm.server_uuid };

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

            cf_cb();
            return;
        } else {
            self.log.trace({ skippedVm: vm }, 'VM state is not relevant');
            cf_cb();
            return;
        }
    });
};

Updater.prototype._write = function (chunk, encoding, cb) {
    var self = this;
    var log = self.log;
    log.trace('_write: start');
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
                    var server_uuid = arg.server.server_uuid;
                    var call = mod_backoff.call(
                        fetchCn,
                        {
                            cache: self.cache,
                            cnapi: self.cnapi,
                            log: log,
                            server_uuid: server_uuid
                        },
                        function (err, res) {
                            if (err) {
                                log.error(err, 'fetchCn failure');
                            } else {
                                log.debug('fetchCn success');
                                next();
                            }
                    });

                    call.on('call', function (opts) {
                        log.trace(opts, 'executing fetchCn');
                    });

                    call.on('callback', function (cErr, cRes) {
                        var fetchCnCbArgs = { cErr: cErr, cRes: cRes };
                        log.trace(fetchCnCbArgs, 'backoff callback');
                    });

                    call.on('backoff', function (number, delay) {
                        var fetchCnBackoffArgs = { num: number, delay: delay };
                        log.debug(fetchCnBackoffArgs, 'backoff called');
                    });

                    var bstrat = new mod_backoff.ExponentialStrategy();
                    call.setStrategy(bstrat);
                    call.failAfter(RETRIES);
                    call.start();
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

function cacheCn(opts, cb) {
    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.cache, 'opts.cache');
    mod_assert.object(opts.cn, 'opts.cn');
    mod_assert.object(opts.log, 'opts.log');
    mod_assert.uuid(opts.server_uuid, 'opts.server_uuid');

    var cache = opts.cache;
    var cn = opts.cn;
    var log = opts.log;
    var server_uuid = opts.server_uuid;

    var admin_ip = firstAdminIp(cn.sysinfo);
    cache.admin_ips.set(admin_ip);

    var call = mod_backoff.call(
        refreshAgentCache,
        { admin_ip: admin_ip, log: log },
        function (err, res) {
            if (err) {
                log.error(err, 'refresh failure');
            } else {
                log.debug(admin_ip, 'refreshed');
                cache.admin_ips.set(server_uuid, { admin_ip: admin_ip });
            }
            cb(err, res);
    });

    call.on('call', function (refreshOpts) {
        log.trace(opts, 'executing refresh');
    });

    call.on('callback', function (cErr, cRes) {
        var cbArgs = { cErr: cErr, cRes: cRes };
        log.trace(cbArgs, 'backoff callback');
    });

    call.on('backoff', function (number, delay) {
        var bfArgs = { num: number, delay: delay };
        log.debug(bfArgs, 'backoff called');
    });

    var bstrat = new mod_backoff.ExponentialStrategy();
    call.setStrategy(bstrat);
    call.failAfter(RETRIES);
    call.start();
}

function fetchCn(opts, cb) {
    mod_assert.object(opts, 'opts');
    mod_assert.object(opts.cache, 'opts.cache');
    mod_assert.object(opts.cnapi, 'opts.cnapi');
    mod_assert.object(opts.log, 'opts.log');
    mod_assert.uuid(opts.server_uuid, 'opts.server_uuid');

    var cache = opts.cache;
    var log = opts.log;
    var server_uuid = opts.server_uuid;

    opts.cnapi.getServer(server_uuid, function (cnapiErr, cn) {
        if (cnapiErr && cnapiErr.statusCode == 404) {
            cache.admin_ips.delete(server_uuid);
            log.info({ server_uuid: server_uuid }, 'Deleted by CNAPI 404');
            cb();
        } else if (cnapiErr) {
            log.error(cnapiErr, 'Error fetching CN');
            cb(cnapiErr);
        } else {
            var ccnOpts =
                {
                    cache: cache,
                    cn: cn,
                    log: log,
                    server_uuid: server_uuid
                };
            cacheCn(ccnOpts, function (err) {
                // cacheCn utilizes backoff, if it has to give up and error the
                // system can not maintain correctness and needs to abort.
                mod_assert.ifError(err);
                cb();
            });
        }
    });
}

// This function matches the admin IP discovery code in cmon-agent and cn-agent
function firstAdminIp(sysinfo) {
    mod_assert.object(sysinfo, 'sysinfo');

    var interfaces = sysinfo['Network Interfaces'];
    for (var iface in interfaces) {
        if (!interfaces.hasOwnProperty(iface)) {
            continue;
        }

        var nic = interfaces[iface]['NIC Names'];
        var isAdmin = nic.indexOf('admin') !== -1;
        if (isAdmin) {
            var ip = interfaces[iface].ip4addr;
            return ip;
        }
    }

    throw new lib_errors.CMONError('No NICs with name "admin" detected.');
}

function refreshAgentCache(opts, cb) {
    mod_assert.object(opts, 'opts');
    mod_assert.string(opts.admin_ip, 'opts.admin_ip');
    mod_assert.object(opts.log, 'opts.log');

    var log = opts.log;
    var admin_ip = opts.admin_ip;
    var cmon_agent_url = 'http://' + admin_ip + ':9163';
    var cmon_agent_path = '/v1/refresh';
    var client = mod_restify.createStringClient(
        {
            url: cmon_agent_url,
            retry: {
                retries: RETRIES,
                minTimeout: MIN_TIMEOUT,
                maxTimeout: MAX_TIMEOUT
            },
            log: log
        });

    client.post(cmon_agent_path, {}, function (err, req, res, data) {
        cb(err, res);
    });
}

module.exports = Updater;

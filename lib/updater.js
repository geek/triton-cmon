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

    mod_vasync.pipeline({
        arg: {},
        funcs: [
            function getVmFromVMAPI(arg, next) {
               if (chunk.source && chunk.source === 'Bootstrapper') {
                  arg.vm_uuid = chunk.vm_uuid;
                  arg.server_uuid = chunk.server_uuid;
                  cache.vms[arg.vm_uuid] = arg.server_uuid;
                  next();
               } else {
                  arg.vm_uuid = chunk.changedResourceId;
                  vmapi.getVm({ uuid: arg.vm_uuid }, function (err1, vm) {
                     mod_assert.ifError(err1, 'Error fetching VM');
                     arg.server_uuid = vm.server_uuid;
                     cache.vms[arg.vm_uuid] = arg.server_uuid;
                     next();
                  });
               }
            },
            function getIpFromNAPI(arg, next) {
                napi.listNics(
                {
                    belongs_to_uuid: arg.server_uuid,
                    belongs_to_type: 'server',
                    nic_tags_provided: 'admin'
                }, function (err2, nics) {
                    mod_assert.ifError(err2, 'Error fetching nics');
                    cache.nics[arg.server_uuid] = arg.nics = nics;
                    next();
                });
            }
        ]
    }, function (err) {
        mod_assert.ifError(err, 'Failure updating cache');
        cb();
   });
};

module.exports = Updater;

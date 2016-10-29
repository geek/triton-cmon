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
var mod_qs = require('querystring');

function Bootstrapper(opts) {
    var streamOpts = {
        objectMode: true,
        highWaterMark: 128
    };

    mod_stream.Readable.call(this, streamOpts);

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

    this.limit = this.maxLimit = 100;

    this.running = false;
    this.fetching = false;
    this.offset = 0;
    this.marker = undefined;

    this.useMarker = undefined;
    this.checkingMarker = false;
    this.filter = undefined;
    this.filterQueue = [];
    this.filterQueueDedupe = {};
}
mod_util.inherits(Bootstrapper, mod_stream.Readable);

Bootstrapper.prototype._read = function () {
    this.fetch();
};

/* We probe vmapi first to see if it has "marker" support or not. */
Bootstrapper.prototype.checkMarker = function () {
    if (this.checkingMarker)
        return;
    this.checkingMarker = true;

    var self = this;
    var q = mod_qs.stringify({
        limit: 1,
        state: 'active',
        marker: JSON.stringify({ uuid: '000000' })
    });
    this.vmapi.get('/vms?' + q, function (err, req, res, objs) {
        var obj_arr = JSON.parse(objs.body);
        if (!err && Array.isArray(obj_arr) && obj_arr.length === 0) {
            self.log.debug('detected marker support in vmapi');
            self.useMarker = true;
        } else {
            self.log.debug('vmapi does not support marker');
            self.useMarker = false;
        }
        self.checkingMarker = false;
        self.start();
        return;
    });
};

Bootstrapper.prototype.start = function (filter) {
    if (this.useMarker === undefined) {
        if (filter)
            this.filterQueue.push(filter);
        this.checkMarker();
        return;
    }

    if (this.running) {
        if (filter) {
            var k = mod_qs.stringify(filter);
            if (this.filterQueueDedupe[k] === undefined) {
                this.filterQueueDedupe[k] = true;
                this.filterQueue.push(filter);
            }
        }
        return;
    }

    if (filter === undefined) {
        filter = { state: 'active' };
    }

    this.log.debug('starting poll, filter = %j', filter);
    this.running = true;
    this.offset = 0;
    this.marker = undefined;
    this.filter = filter;
    this.fetch();
};

Bootstrapper.prototype.fetch = function () {
    if (this.fetching)
        return;
    if (!this.running)
        return;

    this.fetching = true;

    var self = this;
    var q = {
        limit: this.limit
    };

    Object.keys(this.filter).forEach(function (k) {
        q[k] = self.filter[k];
    });

    if (this.useMarker) {
        if (this.marker !== undefined)
            q.marker = JSON.stringify(this.marker);
    } else {
        q.offset = this.offset;
    }

    q = mod_qs.stringify(q);
    self.vmapi.get('/vms?' + q, function (err, req, res, objs) {
        if (err) {
            self.log.error({
                err: err,
                offset: self.offset,
                marker: self.marker,
                limit: self.limit
            }, 'failed fetching active vms, will retry in 1s');
            self.fetching = false;
            setTimeout(self.fetch.bind(self), 1000);
            return;
        }

        var obj_arr = JSON.parse(objs.body);
        var full = false;
        if (obj_arr.length === 0) {
            self.log.debug({ processed: self.offset }, 'finished fetching');
            self.fetching = false;
            self.running = false;
            self.push(null);
            // TODO: remove the queuing for multiple calls stuff
            var f = self.filterQueue.shift();
            if (f !== undefined) {
                var k = mod_qs.stringify(f);
                delete (self.filterQueueDedupe[k]);
                self.start(f);
            }
            return;
        }

        for (var i = 0; i < obj_arr.length; ++i) {
            var obj = obj_arr[i];
            var vm =
            {
                vm_uuid: obj.uuid,
                server_uuid: obj.server_uuid,
                source: 'Bootstrapper'
            };

            self.offset++;
            self.marker = { uuid: obj.uuid };
            if (typeof (obj.uuid) !== 'string') {
                self.log.debug({ uuid: obj.uuid }, 'obj.uuid is not a string');
                continue;
            }

            if (!self.push(vm)) {
                self.log.debug({vm_uuid: obj.uuid}, 'failed pushed');
                process.abort();
                self.limit = Math.round((2 * self.limit + (i + 1)) / 3.0);
                self.log.trace('revising limit down to %d', self.limit);
                full = true;
                break;
            }

            self.log.trace({ pushvm: vm }, 'Pushed');
        }

        if (!full && self.limit < self.maxLimit) {
            self.limit = Math.round((2*self.limit + self.maxLimit) / 3.0);
            self.log.trace('revising limit up to %d', self.limit);
        }

        self.fetching = false;
        setTimeout(self.fetch.bind(self), 100);
    });
};

module.exports = Bootstrapper;

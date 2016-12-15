/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

var mod_assert = require('assert-plus');
var mod_httpSignature = require('http-signature');
var mod_restify = require('restify');
var mod_sshpk = require('sshpk');

var lib_errors = require('./errors');

/* JSSTYLED */
var UUID_REGEXP = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;

var DEFAULT_HOST_PREFIX = 'cmon';

function authenticationHandler(req, res, next) {
    var peerCert = req.connection.getPeerCertificate();
    if (!peerCert || !peerCert.raw) {
        req.log.error({ cert: peerCert, certRaw: peerCert.raw }, 'No cert');
        next(new lib_errors.UnauthorizedError());
    } else {
        var cert = mod_sshpk.parseCertificate(peerCert.raw, 'x509');
        var keyId = cert.subjectKey.fingerprint('md5').toString('hex');
        req.app.mahi.getAccount(cert.subjects[0].cn, function (err, acct) {
            if (err || !acct.account.keys[keyId]) {
                req.log.error({ mahiAcctErr: err }, 'Error getting acct');
                next(new lib_errors.UnauthorizedError());
            } else {
                var key = mod_sshpk.parseKey(acct.account.keys[keyId]);
                if (key.fingerprint('sha512').matches(cert.subjectKey)) {
                    req.account = acct.account;
                    next();
                } else {
                    next(new lib_errors.UnauthorizedError());
                }
            }
        });
    }
}

function authorizationHandler(req, res, next) {
    req.log.trace({ requestAcct: req.account }, 'Current request account');

    mod_assert.object(req.account);
    mod_assert.uuid(req.account.uuid);
    mod_assert.string(req.account.login);

    // req.username is set for the restify throttle plugin
    req.username = req.account.login;

    var account_uuid = req.account.uuid;
    var cache = req.app.cache;

    mod_assert.object(cache, 'cache object');

    // base URI is being called by an authenticated user
    if (req.host_prefix === DEFAULT_HOST_PREFIX) {
        next();
    } else if (cache.owners.has(account_uuid)) {
        var accountVms = cache.owners.get(account_uuid).vms;
        // vm specific URI is being called
        if (accountVms.has(req.host_prefix)) {
            next();
        } else {
            // authenticated user is asking for a VM they do not own
            next(new lib_errors.ForbiddenError());
        }
    }
}

/*
 * Returns a handler that will log uncaught exceptions properly
 */
function uncaughtHandler(req, res, route, err) {
    res.send(new mod_restify.InternalError(err, 'Internal error'));
    /**
     * We don't bother logging the `res` here because it always looks like
     * the following, no added info to the log.
     *
     *      HTTP/1.1 500 Internal Server Error
     *      Content-Type: application/json
     *      Content-Length: 51
     *      Date: Wed, 29 Oct 2014 17:33:02 GMT
     *      x-request-id: a1fb11c0-5f91-11e4-92c7-3755959764aa
     *      x-response-time: 9
     *      Connection: keep-alive
     *
     *      {"code":"InternalError","message":"Internal error"}
     */
    req.log.error({err: err, route: route && route.name,
        req: req}, 'Uncaught exception');
}

function enforceSSLHandler(req, res, next) {
    if (!req.isSecure()) {
        next(new lib_errors.SSLRequiredError());
    } else {
        next();
    }
}

function enforceHostHandler(req, res, next) {
    var host = req.header('HOST');
    if (!host) {
        next(new lib_errors.NotFoundError());
        return;
    }

    var prefix = host.split('.')[0];
    if (prefix === 'cmon' || UUID_REGEXP.test(prefix)) {
        req.host_prefix = prefix;
        next();
    } else {
        next(new lib_errors.NotFoundError());
    }
}

function mapVm(vm, source, cb) {
    var err;
    var mappedVm;

    if (!(typeof (vm) === 'object')) {
        err = new Error('vm must be an object');
    } else if (!(typeof (vm.server_uuid) === 'string')) {
        err = new Error('vm.server_uuid must be a string');
    } else if (!(typeof (source) === 'string')) {
        err = new Error('source must be a string');
    } else if (vm.alias && !(typeof (vm.alias) === 'string')) {
        err = new Error('vm.alias must be a string');
    } else if (!(typeof (vm.image_uuid) === 'string')) {
        err = new Error('vm.image_uuid must be a string');
    } else if (!(typeof (vm.owner_uuid) === 'string')) {
        err = new Error('vm.owner_uuid must be a string');
    } else if (!(typeof (vm.uuid) === 'string')) {
        err = new Error('vm.uuid must be a string');
    } else {
        mappedVm =
        {
            server_uuid: vm.server_uuid,
            source: source,
            vm_alias: vm.alias,
            vm_image_uuid: vm.image_uuid,
            vm_owner_uuid: vm.owner_uuid,
            vm_uuid: vm.uuid
        };
    }

    cb(err, mappedVm);
}

function cacheVm(vm, cache, cb) {
    var err;
    if (!(typeof (vm) === 'object')) {
        err = new Error('vm must be an object');
    } else if (!(typeof (cache) === 'object')) {
        err = new Error('cache must be an object');
    } else if (!(typeof (cache.vms) === 'object')) {
        err = new Error('cache.vms must be an object');
    } else if (!(typeof (cache.owners) === 'object')) {
        err = new Error('cache.owners must be an object');
    } else if (!(typeof (vm.server_uuid) === 'string')) {
        err = new Error('vm.server_uuid must be a string');
    } else if (!(typeof (vm.source) === 'string')) {
        err = new Error('vm.source must be a string');
    } else if (vm.vm_alias && !(typeof (vm.vm_alias) === 'string')) {
        err = new Error('vm.vm_alias must be a string');
    } else if (!(typeof (vm.vm_image_uuid) === 'string')) {
        err = new Error('vm.vm_image_uuid must be a string');
    } else if (!(typeof (vm.vm_owner_uuid) === 'string')) {
        err = new Error('vm.vm_owner_uuid must be a string');
    } else if (!(typeof (vm.vm_uuid) === 'string')) {
        err = new Error('vm.vm_uuid must be a string');
    } else {
        vm.cached_date = Date.now();
        cache.vms.set(vm.vm_uuid, vm);

        if (!cache.owners.has(vm.vm_owner_uuid)) {
            cache.owners.set(vm.vm_owner_uuid, { vms: new Map() });
        }

        var ownerVms = cache.owners.get(vm.vm_owner_uuid).vms;
        ownerVms.set(vm.vm_uuid, vm);
    }

    cb(err);
}

module.exports = {
    authenticationHandler: authenticationHandler,
    authorizationHandler: authorizationHandler,
    cacheVm: cacheVm,
    enforceHostHandler: enforceHostHandler,
    enforceSSLHandler: enforceSSLHandler,
    mapVm: mapVm,
    uncaughtHandler: uncaughtHandler
};

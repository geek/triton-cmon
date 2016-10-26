/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 */

var mod_restify = require('restify');
var mod_httpSignature = require('http-signature');
var mod_sshpk = require('sshpk');

var lib_errors = require('./errors');

function authenticationHandler(req, res, next) {
    var peerCert = req.connection.getPeerCertificate();
    var cert = mod_sshpk.parseCertificate(peerCert.raw, 'x509');
    var keyId = cert.subjectKey.fingerprint('md5').toString('hex');
    req.app.mahi.getAccount(cert.subjects[0].cn, function (err, acct) {
        var authKey = mod_sshpk.parseKey(acct.keys[keyId]);
        if (authKey.fingerprint('sha512').matches(peerCert.subjectKey)) {
            req.log.info('Authenticated');
        }
    });
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

module.exports = {
    uncaughtHandler: uncaughtHandler,
    authenticationHandler: authenticationHandler,
    enforceSSLHandler: enforceSSLHandler
};

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

var lib_errors = require('./errors');

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

function authorizationParser(req, res, next) {
    req.authorization = {};
    var error;
    if (req.headers.authorization) {
        var pieces = req.headers.authorization.split(' ', 2);
        if (!pieces || pieces.length !== 2) {
            error = new mod_restify.InvalidHeaderError(
                'Invalid Authorization header');
        } else {
            req.authorization.scheme = pieces[0];
            req.authorization.credentials = pieces[1];
            if (pieces[0].toLowerCase() === 'signature') {
                try {
                    var parsedRequest = mod_httpSignature.parseRequest(req);
                    req.authorization.signature = parsedRequest;
                } catch (parsedRequestError) {
                    error = new mod_restify.InvalidHeaderError(
                        'Invalid Signature ' + 'Authorization header: ' +
                        parsedRequestError.message);
                    throw (error);
                }
            }
        }
    }
    next(error);
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
    authorizationParser: authorizationParser,
    enforceSSLHandler: enforceSSLHandler
};

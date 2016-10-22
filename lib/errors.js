/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2016, Joyent, Inc.
 */

var mod_restify = require('restify');
var mod_util = require('util');

///--- Globals

var sprintf = mod_util.format;
var RestError = mod_restify.RestError;


///--- Errors

function CMONError(obj) {
    obj.constructorOpt = this.constructor;
    RestError.call(this, obj);
}
mod_util.inherits(CMONError, RestError);

function SSLRequiredError() {
    CMONError.call(this, {
        restCode: 'SecureTransportRequired',
        statusCode: 403,
        message: 'Container Monitor requires a secure transport (SSL/TLS)'
    });
}
mod_util.inherits(SSLRequiredError, CMONError);
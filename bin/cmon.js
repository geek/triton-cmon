'use strict';

var mod_fs = require('fs');
var mod_path = require('path');

var Server = require('../lib/server');

var configFilename = mod_path.join(__dirname, '..', 'config', 'config.json');

function loadConfig(filename, callback) {
    mod_fs.readFile(filename, function (error, data) {
        if (error) {
            callback(error);
            return;
        }
        callback(error, JSON.parse(data.toString()));
        return;
    });
}

loadConfig(configFilename, function (error, config) {
    if (error) {
        return;
    } else {
        var server = new Server(config);
        server.start();
    }
});

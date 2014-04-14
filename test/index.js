'use strict';

require.config({
    baseUrl: '../',
    paths: {
        'test': '../test',
        'chai': '../node_modules/chai/chai',
        'mimefuncs': '../node_modules/mimefuncs/src/mimefuncs',
        'addressparser': '../node_modules/addressparser/src/addressparser',
        'stringencoding': '../node_modules/stringencoding/dist/stringencoding'
    }
});


mocha.setup('bdd');
require(['test/mimeparser-unit'], function() {
    (window.mochaPhantomJS || window.mocha).run();
});
'use strict';

require.config({
    baseUrl: '../',
    paths: {
        'test': '../test',
        'chai': '../node_modules/chai/chai',
        'mimefuncs': '../node_modules/mimefuncs/src/mimefuncs',
        'stringencoding': '../node_modules/stringencoding/dist/stringencoding'
    }
});


mocha.setup('bdd');
require(['test/mimeparser-unit'], function() {
    (window.mochaPhantomJS || window.mocha).run();
});
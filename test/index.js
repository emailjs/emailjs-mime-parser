'use strict';

require.config({
    baseUrl: '../',
    paths: {
        'test': './test',
        'chai': './node_modules/chai/chai',
        'mimefuncs': './node_modules/mimefuncs/src/mimefuncs',
        'addressparser': './node_modules/wo-addressparser/src/addressparser',
        'stringencoding': './node_modules/wo-stringencoding/dist/stringencoding',
        'sinon': './node_modules/sinon/pkg/sinon',
        'mimeparser-tzabbr': './src/mimeparser-tzabbr'
    },
    shim: {
        sinon: {
            exports: 'sinon',
        }
    }
});


mocha.setup('bdd');
require(['test/mimeparser-unit'], function() {
    (window.mochaPhantomJS || window.mocha).run();
});
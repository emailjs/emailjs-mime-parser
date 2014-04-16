'use strict';

if (typeof define !== 'function') {
    var define = require('amdefine')(module);
}

define(['chai', '../src/mimeparser', 'stringencoding'], function(chai, Mimeparser, encoding) {

    var expect = chai.expect;
    var TextDecoder = encoding.TextDecoder;
    chai.Assertion.includeStack = true;

    describe('mimeparser', function() {
        var parser;

        beforeEach(function() {
            parser = new Mimeparser();
        });

        describe('simple message', function() {
            it('should succeed', function(done) {
                var fixture = 'From: Sender Name <sender.name@example.com>\r\nTo: Receiver Name <receiver.name@example.com>\r\nSubject: Hello world!\r\nDate: Fri, 4 Oct 2013 07:17:32 +0000\r\nMessage-Id: <simplemessage@localhost>\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n\r\nHi,\r\n\r\nthis is a private conversation. To read my encrypted message below, simply =\r\nopen it in Whiteout Mail.\r\nOpen Whiteout Mail: https://chrome.google.com/webstore/detail/jjgghafhamhol=\r\njigjoghcfcekhkonijg\r\n\r\n';
                parser.onheader = function(node) {
                    expect(node.header).to.deep.equal([
                        'From: Sender Name <sender.name@example.com>',
                        'To: Receiver Name <receiver.name@example.com>',
                        'Subject: Hello world!',
                        'Date: Fri, 4 Oct 2013 07:17:32 +0000',
                        'Message-Id: <simplemessage@localhost>',
                        'Content-Type: text/plain; charset=\"utf-8\"',
                        'Content-Transfer-Encoding: quoted-printable'
                    ]);
                };

                var expectedText = '\nHi,\n\nthis is a private conversation. To read my encrypted message below, simply open it in Whiteout Mail.\nOpen Whiteout Mail: https://chrome.google.com/webstore/detail/jjgghafhamholjigjoghcfcekhkonijg\n\n';
                parser.onbody = function(node, chunk) {
                    expect(new TextDecoder('utf-8').decode(chunk)).to.equal(expectedText);
                };

                parser.onend = function() {
                    expect(parser.nodes).to.not.be.empty;
                    expect(new TextDecoder('utf-8').decode(parser.nodes.node.content)).to.equal(expectedText);

                    done();
                };
                parser.write(fixture);
                parser.end();
            });

            it('should parse specific headers', function(done) {
                var fixture = 'From: Sender Name <sender.name@example.com>\r\nTo: Receiver Name <receiver.name@example.com>\r\nSubject: Hello world!\r\nDate: Fri, 4 Oct 2013 07:17:32 +0000\r\nMessage-Id: <simplemessage@localhost>\r\nContent-Type: multipart/signed; protocol="TYPE/STYPE"; micalg="MICALG"; boundary="Signed Boundary"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n';
                parser.onheader = function(node) {

                    expect(node.headers.from).to.deep.equal([{
                        value: [{
                            address: 'sender.name@example.com',
                            name: 'Sender Name'
                        }],
                        initial: 'Sender Name <sender.name@example.com>'
                    }]);

                    expect(node.headers.subject).to.deep.equal([{
                        value: 'Hello world!',
                        initial: 'Hello world!'
                    }]);

                    expect(node.headers['content-type']).to.deep.equal([{
                        value: 'multipart/signed',
                        params: {
                            boundary: 'Signed Boundary',
                            micalg: 'MICALG',
                            protocol: 'TYPE/STYPE'
                        },
                        type: 'multipart',
                        initial: 'multipart/signed; protocol="TYPE/STYPE"; micalg="MICALG"; boundary="Signed Boundary"'
                    }]);

                };

                parser.onend = function() {
                    done();
                };

                parser.write(fixture);
                parser.end();
            });

            it('should parse header and body', function(done) {
                var fixture = 'Content-Type: text/plain; name="foo.txt"\r\nContent-Disposition: attachment; filename="foo.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nZm9vZm9vZm9vZm9vZm9v\r\n';

                parser.onheader = function(node) {
                    expect(node.header).to.deep.equal([
                        'Content-Type: text/plain; name="foo.txt"',
                        'Content-Disposition: attachment; filename="foo.txt"',
                        'Content-Transfer-Encoding: base64'
                    ]);
                };

                parser.onbody = function(node, chunk) {
                    expect(new TextDecoder('utf-8').decode(chunk)).to.equal('foofoofoofoofoo');
                };

                parser.onend = function() {
                    expect(parser.nodes).to.not.be.empty;
                    expect(new TextDecoder('utf-8').decode(parser.nodes.node.content)).to.equal('foofoofoofoofoo');
                    done();
                };
                parser.write(fixture);
                parser.end();
            });

            it('should parse encoded headers', function(done) {
                var fixture = 'Subject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n' +
                    ' =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n' +
                    'Content-Disposition: attachment;\r\n' +
                    '  filename*0*=UTF-8\'\'%C3%95%C3%84;\r\n' +
                    '  filename*1*=%C3%96%C3%9C\r\n' +
                    'From: =?gb2312?B?086yyZjl?= user@ldkf.com.tw\r\n' +
                    'To: =?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?=:=?gb2312?B?086yyZjl?= user@ldkf.com.tw;\r\n' +
                    'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
                    '\r\n' +
                    'abc';
                parser.onheader = function(node) {
                    expect(node.headers).to.deep.equal({
                        subject: [{
                            value: 'Avaldus lepingu lõpetamiseks',
                            initial: '=?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?= =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?='
                        }],
                        'content-disposition': [{
                            value: 'attachment',
                            params: {
                                filename: 'ÕÄÖÜ'
                            },
                            initial: 'attachment;  filename*0*=UTF-8\'\'%C3%95%C3%84;  filename*1*=%C3%96%C3%9C'
                        }, {
                            value: 'attachment',
                            params: {
                                filename: 'ÕÄÖÜ'
                            },
                            initial: 'attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="'
                        }],
                        from: [{
                            value: [{
                                address: 'user@ldkf.com.tw',
                                name: '游采樺'
                            }],
                            initial: '=?gb2312?B?086yyZjl?= user@ldkf.com.tw'
                        }],
                        to: [{
                            value: [{
                                name: 'ÕÄÖÜ',
                                group: [{
                                    address: 'user@ldkf.com.tw',
                                    name: '游采樺'
                                }]
                            }],
                            initial: '=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?=:=?gb2312?B?086yyZjl?= user@ldkf.com.tw;'
                        }]
                    });
                };

                parser.onend = function() {
                    done();
                };

                parser.write(fixture);
                parser.end();
            });

            it('should decode plaintext body from latin-1 charset', function(done) {
                var fixture = 'Content-Type: text/plain; charset="latin_1"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nl=F5petam';
                var expectedText = 'lõpetam';

                parser.onbody = function(node, chunk) {
                    expect(new TextDecoder('utf-8').decode(chunk)).to.equal(expectedText);
                };

                parser.onend = function() {
                    expect(new TextDecoder('utf-8').decode(parser.nodes.node.content)).to.equal(expectedText);
                    done();
                };
                parser.write(fixture);
                parser.end();
            });

            it('should ignore charset for plaintext attachment', function(done) {
                var fixture = 'Content-Type: text/plain; charset="latin_1"\r\nContent-Disposition: attachment\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nl=F5petam';
                var expectedText = 'lõpetam';

                parser.onbody = function(node, chunk) {
                    expect(new TextDecoder('iso-8859-1').decode(chunk)).to.equal(expectedText);
                };

                parser.onend = function() {
                    expect(new TextDecoder('iso-8859-1').decode(parser.nodes.node.content)).to.equal(expectedText);
                    done();
                };
                parser.write(fixture);
                parser.end();
            });

            it('should detect charset from html', function(done) {
                var fixture = 'Content-Type: text/plain;\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=3Cmeta=20charset=3D=22latin_1=22/=3E=D5=C4=D6=DC';
                var expectedText = '<meta charset="latin_1"/>ÕÄÖÜ';

                parser.onbody = function(node, chunk) {
                    expect(new TextDecoder('utf-8').decode(chunk)).to.equal(expectedText);
                };

                parser.onend = function() {
                    expect(new TextDecoder('utf-8').decode(parser.nodes.node.content)).to.equal(expectedText);
                    done();
                };
                parser.write(fixture);
                parser.end();
            });

            it('should use latin1 as the default for headers', function(done) {
                var fixture = 'a: \xD5\xC4\xD6\xDC\r\nContent-Type: text/plain\r\nb: \xD5\xC4\xD6\xDC\r\n\r\n';

                parser.onheader = function(node) {
                    expect(node.headers.a[0].value).to.equal('ÕÄÖÜ');
                    expect(node.headers.b[0].value).to.equal('ÕÄÖÜ');
                };

                parser.onend = done;
                parser.write(fixture);
                parser.end();
            });

            it('should detect 8bit header encoding from content-type', function(done) {
                var fixture = 'a: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C\r\nContent-Type: text/plain; charset=utf-8\r\nb: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C\r\n\r\n';

                parser.onheader = function(node) {
                    expect(node.headers.a[0].value).to.equal('ÕÄÖÜ');
                    expect(node.headers.b[0].value).to.equal('ÕÄÖÜ');
                };

                parser.onend = done;
                parser.write(fixture);
                parser.end();
            });
        });

        describe('#_detectHTMLCharset', function() {
            var node;

            beforeEach(function() {
                node = parser.node;
            });

            it('should detect charset from simple meta', function() {
                expect(node._detectHTMLCharset('\n\n<meta charset="utf-8">')).to.equal('utf-8');
                expect(node._detectHTMLCharset('\n\n<meta\n charset="utf-8">')).to.equal('utf-8');
                expect(node._detectHTMLCharset('\n\n<meta\n charset=utf-8>')).to.equal('utf-8');
            });

            it('should detect charset from http-equiv meta', function() {
                expect(node._detectHTMLCharset('\n\n<meta http-equiv="content-type" content="text/html; charset=utf-8" />')).to.equal('utf-8');
                expect(node._detectHTMLCharset('\n\n<meta http-equiv=content-type content="text/html; charset=utf-8" />')).to.equal('utf-8');
            });
        });
    });
});
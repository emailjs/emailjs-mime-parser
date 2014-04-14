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
        });
    });
});
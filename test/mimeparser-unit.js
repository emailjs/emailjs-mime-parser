define(['chai', 'mimeparser'], function(chai, Mimeparser) {
    'use strict';

    var expect = chai.expect;
    chai.Assertion.includeStack = true;

    describe('mimeparser', function() {
        var parser;

        beforeEach(function() {
            parser = new Mimeparser();
        });

        describe('simple message', function() {
            it('should succeed', function(done) {
                var fixture = 'From: Sender Name <sender.name@example.com>\r\nTo: Receiver Name <receiver.name@example.com>\r\nSubject: Hello world!\r\nDate: Fri, 4 Oct 2013 07:17:32 +0000\r\nMessage-Id: <simplemessage@localhost>\r\n\r\nHello world!';
                parser.onheader = function(node) {
                    expect(node.header).to.deep.equal([
                        'From: Sender Name <sender.name@example.com>',
                        'To: Receiver Name <receiver.name@example.com>',
                        'Subject: Hello world!',
                        'Date: Fri, 4 Oct 2013 07:17:32 +0000',
                        'Message-Id: <simplemessage@localhost>'
                    ]);
                };

                parser.onbody = function(node, chunk) {
                    expect(new TextDecoder('utf-8').decode(chunk)).to.equal('Hello world!');
                };

                parser.onend = done;
                parser.end(fixture);
            });
        });
    });
});
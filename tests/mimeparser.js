
var fixtures = {
    "simple": "From: Sender Name <sender.name@example.com>\r\n"+
              "To: Receiver Name <receiver.name@example.com>\r\n"+
              "Subject: Hello world!\r\n"+
              "Date: Fri, 4 Oct 2013 07:17:32 +0000\r\n"+
              "Message-Id: <simplemessage@localhost>\r\n"+
              "\r\n"+
              "Hello world!"
};

test("Create parser instance", function(){
    var parser = mimeparser();
    ok(parser);
});

asyncTest("Parse simple message", function(){
    var parser = mimeparser();

    expect(3);

    parser.onheader = function(node){
        
        deepEqual(node.header, [
            "From: Sender Name <sender.name@example.com>",
            "To: Receiver Name <receiver.name@example.com>",
            "Subject: Hello world!",
            "Date: Fri, 4 Oct 2013 07:17:32 +0000",
            "Message-Id: <simplemessage@localhost>"
        ]);

    };

    parser.onbody = function(node, chunk){
        equal(new TextDecoder("utf-8").decode(chunk), "Hello world!");
    };

    parser.onend = function(){
        ok(true);
        start();
    };

    parser.end(fixtures.simple);
});

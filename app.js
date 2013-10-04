
require(["mimeparser"], function(mimeparser) {
    window.parse = function(){

        var parser = mimeparser({chunkSize: Math.min(Math.abs(Number(document.getElementById("chunksize").value) || 1024), 128 * 1024)}),
            input = document.getElementById("in").value,
            inputSize = Math.min(Math.abs(Number(document.getElementById("inputsize").value) || 1), 128 * 1024),
            i, len, chr, buf, bytes;

        parser.onheader = function(node){
            var title = "HEADERS" + (node.path.length ? " for part nr. " + node.path.join(".") : "");
                str = "\n\n" + title + "\n" + Array(title.length + 1).join("-") + "\n" + node.header.join("\n");
            if(node.path.length){
                str = str.replace(/^/mg, Array(node.path.length + 1).join("    "));
            }
            log(str);
        };

        parser.onbody = function(node, chunk){
            var title = "BODYCHUNK" + (node.path.length ? " for part nr. " + node.path.join(".") : ""),
                str = "\n\n" + title + "\n" + Array(title.length + 1).join("-") + "\n" + String.fromCharCode.apply(String, chunk);
            if(node.path.length){
                str = str.replace(/^/mg, Array(node.path.length + 2).join("    "));
            }
            log(str);
        };

        parser.onend = function(){
            log("\n\n----\nDONE");
        };

        // convert to "binary"
        input = encodeURIComponent(input).replace(/%([a-f0-9]{2})/gi, function(o, code){
            return String.fromCharCode(parseInt(code, 16));
        });

        var pos = 0;

        function writeBytes(){
            if(pos >= input.length){
                return parser.end();
            }
            var str = input.substr(pos, inputSize);
            pos += str.length;
            
            parser.write(str);
            setTimeout(writeBytes, 1);
        }
        log("START");
        writeBytes();
    }
});

function log(str){
    document.getElementById("log").innerHTML += str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
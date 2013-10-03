
require(["mimeparser"], function(mimeparser) {
    window.parse = function(){

        var parser = mimeparser({chunkSize: Number(document.getElementById("chunksize").value) || 1024}),
            input = document.getElementById("in").value,
            i, len, chr, buf, bytes;

        parser.on("header", function(node){
            var title = "HEADERS" + (node.path.length ? " for part nr. " + node.path.join(".") : "");
                str = "\n\n" + title + "\n" + Array(title.length + 1).join("-") + "\n" + node.header.join("\n");
            if(node.path.length){
                str = str.replace(/^/mg, Array(node.path.length + 1).join("    "));
            }
            log(str);
        });

        parser.on("body", function(node, chunk){
            var title = "BODYCHUNK" + (node.path.length ? " for part nr. " + node.path.join(".") : ""),
                str = "\n\n" + title + "\n" + Array(title.length + 1).join("-") + "\n" + String.fromCharCode.apply(String, chunk);
            if(node.path.length){
                str = str.replace(/^/mg, Array(node.path.length + 2).join("    "));
            }
            log(str);
        });

        parser.on("end", function(){
            log("\n\n----\nDONE");
        });

        // convert to "binary"
        input = encodeURIComponent(input).replace(/%([a-f0-9]{2})/gi, function(o, code){
            return String.fromCharCode(parseInt(code, 16));
        });

        var pos = 0;

        function writeByte(){
            if(pos >= input.length){
                return parser.end();
            }
            chr = encodeURIComponent(input.charCodeAt(pos++));
            buf = new Uint8Array([chr]);
            parser.write(buf);
            setTimeout(writeByte, 1);
        }
        log("START");
        writeByte();
    }
});

function log(str){
    document.getElementById("log").innerHTML += str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
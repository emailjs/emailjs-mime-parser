// Copyright (c) 2013 Andris Reinman
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// AMD shim
/* global define: false, easyevents: false, mimefuncs: false */
(function(root, factory) {

    "use strict";

    if (typeof define === 'function' && define.amd) {
        define([
            "easyevents",
            "mimefuncs"
            ], factory);
    } else {
        root.mimeparser = factory(easyevents, mimefuncs);
    }
}(this, function(easyevents, mimefuncs) {

    "use strict";

    function MimeParser(options){
        easyevents.apply(this);

        options = options || {};

        this.chunkSize = options.chunkSize || 64 * 1024;

        this.tree = this.node = new MimeNode(null, this);
        this._remainder = "";
    }
    easyevents.extend(MimeParser);

    MimeParser.prototype.write = function(chunk){
        if(!chunk || !chunk.length){
            return !this._eventsPaused;
        }

        var lines = (this._remainder + (typeof chunk == "object" ? 
            mimefuncs.fromArrayBuffer(chunk) : chunk)).split(/\r?\n/g);
        this._remainder = lines.pop();

        for(var i=0, len = lines.length; i < len; i++){
            this.node.processLine(lines[i]);
        }

        return !this._eventsPaused;
    };

    MimeParser.prototype.end = function(chunk){
        if(chunk && chunk.length){
            this.write(chunk);
        }

        if(this._remainder.length){
            this.node.processLine(this._remainder);
        }

        if(this.node){
            this.node.finalize();
        }

        this.emit("end");
    };

    function MimeNode(parentNode, parser){
        this.parser = parser;
        this.parentNode = parentNode;
        this.state = "HEADER";
        this.lastHeaderKey = false;
        this.header = [];
        this.body = "";
        this.bodyLines = 0;
        this.childNodes = false;
        this.childNode = false;
        this.lineRemainder = "";
        this.headers = {};

        this.path = parentNode ? parentNode.path.concat(parentNode.childNodes.length + 1) : [];
    }

    MimeNode.prototype.processLine = function(line){
        if(this.state == "HEADER"){
            this.processHeaderLine(line);
        }else if(this.state == "BODY"){
            this.processBodyLine(line);
        }
    };

    MimeNode.prototype.processHeaderLine = function(line){
        if(!line){
            this.parseHeaders();
            this.parser.emit("header", this);
            this.state = "BODY";
            return;
        }

        if(line.match(/^\s/) && this.header.length){
            this.header[this.header.length - 1] += "\n" + line;
        }else{
            this.header.push(line);
        }
    };

    MimeNode.prototype.parseHeaders = function(){

        // Join header lines
        var key, value;

        for(var i=0, len = this.header.length; i < len; i++){
            value = this.header[i].split(":");
            key = (value.shift() || "").trim().toLowerCase();
            value = (value.join(":") || "").replace(/\n/g, "").trim();

            if(!this.headers[key]){
                this.headers[key] = [value];
            }else{
                this.headers[key].push(value);
            }
        }

        this.processContentType();
        this.processContentTransferEncoding();
    };

    MimeNode.prototype.processContentType = function(){
        this.contentType = this.parseHeaderValue(
            this.headers["content-type"] && this.headers["content-type"][0] || "text/plain");
        this.contentType.value = (this.contentType.value || "").toLowerCase().trim();
        this.contentType.type = (this.contentType.value.split("/").shift() || "text");

        if(this.contentType.type == "multipart" && this.contentType.params.boundary){
            this.childNodes = [];
            this.multipart = (this.contentType.value.split("/").pop() || "mixed");
            this.boundary = this.contentType.params.boundary;
        }

        if(this.contentType.value == "message/rfc822"){
            this.childNodes = [];
            this.childNode = new MimeNode(this, this.parser);
            this.childNodes.push(this.childNode);
            this.messageRFC822 = true;
        }
    };

    MimeNode.prototype.processContentTransferEncoding = function(){
        this.contentTransferEncoding = this.parseHeaderValue(
            this.headers["content-transfer-encoding"] && this.headers["content-transfer-encoding"][0] || "7bit");
        this.contentTransferEncoding.value = (this.contentTransferEncoding.value || "").toLowerCase().trim();
    };

    MimeNode.prototype.parseHeaderValue = function(str){
        var response = {
                value: false,
                params: {}
            },
            key = false,
            value = "", 
            type = "value",
            quote = false, 
            escaped = false, 
            chr;

        for(var i=0, len = str.length; i<len; i++){
            chr = str.charAt(i);
            if(type == "key"){
                if(chr == "="){
                    key = value.trim().toLowerCase();
                    type = "value";
                    value = "";
                    continue;
                }
                value += chr;
            }else{
                if(escaped){
                    value += chr;
                }else if(chr == "\\"){
                    escaped = true;
                    continue;
                }else if(quote && chr == quote){
                    quote = false;
                }else if(!quote && chr == '"'){
                    quote = chr;
                }else if(!quote && chr == ";"){
                    if(key === false){
                        response.value = value.trim();
                    }else{
                        response.params[key] = value.trim();    
                    }
                    type = "key";
                    value = "";
                }else{
                    value += chr;
                }
                escaped = false;

            }
        }

        if(type == "value"){
            if(key === false){
                response.value = value.trim();
            }else{
                response.params[key] = value.trim();
            }
        }else if(value.trim()){
            response.params[value.trim().toLowerCase()] = "";
        }
        return response;
    };

    MimeNode.prototype.processBodyLine = function(line){
        var curLine, match;

        this.bodyLines++;

        if(this.boundary){
            if(line == "--" + this.boundary){
                if(this.childNode){
                    this.childNode.finalize();
                }
                this.childNode = new MimeNode(this, this.parser);
                this.childNodes.push(this.childNode);
            }else if(line == "--" + this.boundary + "--"){
                if(this.childNode){
                    this.childNode.finalize();
                }
                this.childNode = false;
            }else if(this.childNode){
                this.childNode.processLine(line);
            }else{
                // Ignore body for multipart
            }
        }else if(this.messageRFC822){
            this.childNode.processLine(line);
        }else{
            switch(this.contentTransferEncoding.value){
                case "base64":
                    curLine = this.lineRemainder + line.trim();

                    if(curLine.length % 4){
                        this.lineRemainder = curLine.substr(- curLine.length % 4);
                        curLine = curLine.substr(0, curLine.length - this.lineRemainder.length);
                    }else{
                        this.lineRemainder = "";
                    }

                    if(curLine.length){
                        this.body += mimefuncs.fromArrayBuffer(mimefuncs.base64.decode(curLine));
                    }

                    break;
                case "quoted-printable":
                    curLine = this.lineRemainder + (this.bodyLines > 1 ? "\n" : "") + line;
                    if((match = curLine.match(/=[a-f0-9]{0,1}$/i))){
                        this.lineRemainder = match[0];
                        curLine = curLine.substr(0, curLine.length - this.lineRemainder.length);
                    }

                    this.body += curLine.replace(/=([a-f0-9]{2})/ig, function(m, code){
                        return String.fromCharCode(parseInt(code, 16));
                    });
                    break;
                // case "7bit":
                // case "8bit":
                default:
                    this.body += (this.bodyLines > 1 ? "\n" : "") + line;
                    break;
            }
            this.emitBody();
        }
    };

    MimeNode.prototype.emitBody = function(forceEmit){
        var emitStr = "";
        
        if(this.state != "BODY" || this.boundary || !this.body){
            return;
        }

        if(forceEmit || this.body.length >= this.parser.chunkSize){
            emitStr = this.body.substr(0, this.parser.chunkSize);
            this.body = this.body.substr(emitStr.length);
            this.parser.emit("body", this, mimefuncs.toArrayBuffer(emitStr));
        }
    };

    MimeNode.prototype.finalize = function(){
        if(this.messageRFC822){
            this.childNode.finalize();
        }else{
            this.emitBody(true);
        }
    };

    return function(options){
        return new MimeParser(options);
    };
}));

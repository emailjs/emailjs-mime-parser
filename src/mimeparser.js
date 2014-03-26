// Copyright (c) 2013 Andris Reinman
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

(function(root, factory) {
    'use strict';

    if (typeof define === 'function' && define.amd) {
        define(['mimefuncs'], factory);
    } else {
        root.MimeParser = factory(mimefuncs);
    }
}(this, function(mimefuncs) {
    'use strict';

    /**
     * Creates a parser for a mime stream
     *
     * @constructor
     */
    function MimeParser() {
        /**
         * Returned to the write calls
         */
        this.running = true;

        /**
         * Cache for parsed node objects
         */
        this.nodes = {};

        /**
         * Root node object
         */
        this.node = new MimeNode(null, this);

        /**
         * Data is written to nodes one line at the time. If entire line
         * is not received yet, buffer it before passing on
         */
        this._remainder = '';
    }

    /**
     * Writes a chunk of data to the processing queue. Splits data to lines and feeds
     * complete lines to the current node element
     *
     * @param {ArrayBuffer|String} chunk Chunk to be processed. Either an ArrayBuffer value or a 'binary' string
     */
    MimeParser.prototype.write = function(chunk) {
        if (!chunk || !chunk.length) {
            return !this.running;
        }

        var lines = (this._remainder + (typeof chunk === 'object' ?
            mimefuncs.fromArrayBuffer(chunk) : chunk)).split(/\r?\n/g);
        this._remainder = lines.pop();

        for (var i = 0, len = lines.length; i < len; i++) {
            this.node.writeLine(lines[i]);
        }

        return !this.running;
    };

    /**
     * Indicates that there is no more data coming
     *
     * @param {ArrayBuffer|String} [chunk] Final chunk to be processed
     */
    MimeParser.prototype.end = function(chunk) {
        if (chunk && chunk.length) {
            this.write(chunk);
        }

        if (this._remainder.length) {
            this.node.writeLine(this._remainder);
        }

        if (this.node) {
            this.node.finalize();
        }

        this.onend();
    };

    /**
     * Retrieves a mime part object for specified path
     *
     *   parser.getNode('1.2.3')
     *
     * @param {String} path Path to the node
     */
    MimeParser.prototype.getNode = function(path) {
        return this.nodes['node' + path] || null;
    };

    // PARSER EVENTS

    /**
     * Override this function.
     * Called when the parsing is ended
     * @event
     */
    MimeParser.prototype.onend = function() {};

    /**
     * Override this function.
     * Called when the parsing is ended
     * @event
     * @param {Object} node Current mime part. See node.header for header lines
     */
    MimeParser.prototype.onheader = function() {};

    /**
     * Override this function.
     * Called when a body chunk is emitted
     * @event
     * @param {Object} node Current mime part
     * @param {ArrayBuffer} chunk Body chunk
     */
    MimeParser.prototype.onbody = function() {};

    // NODE PROCESSING

    /**
     * Creates an object that holds and manages one part of the multipart message
     *
     * @constructor
     * @param {Object} parentNode Reference to the parent element. If not specified, then this is root node
     * @param {Object} parser MimeParser object
     */
    function MimeNode(parentNode, parser) {

        // Public properties

        /**
         * An array of unfolded header lines
         */
        this.header = [];

        /**
         * An object that holds header key=value pairs
         */
        this.headers = {};

        /**
         * Path for this node
         */
        this.path = parentNode ? parentNode.path.concat(parentNode._childNodes.length + 1) : [];

        // Private properties

        /**
         * Reference to the 'master' parser object
         */
        this._parser = parser;

        /**
         * Parent node for this specific node
         */
        this._parentNode = parentNode;

        /**
         * Current state, always starts out with HEADER
         */
        this._state = 'HEADER';

        /**
         * Body buffer. Should never be longer than chunkSize
         */
        this._bodyBuffer = '';

        /**
         * Line counter bor the body part
         */
        this._lineCount = 0;

        /**
         * If this is a multipart or message/rfc822 mime part, the value
         * will be converted to array and hold all child nodes for this node
         */
        this._childNodes = false;

        /**
         * Active child node (if available)
         */
        this._currentChild = false;

        /**
         * Remainder string when dealing with base64 and qp values
         */
        this._lineRemainder = '';

        /**
         * Indicates if this is a multipart node
         */
        this._isMultipart = false;

        /**
         * Stores boundary value for current multipart node
         */
        this._multipartBoundary = false;

        /**
         * Indicates if this is a message/rfc822 node
         */
        this._isRfc822 = false;

        // Att this node to the path cache
        this._parser.nodes['node' + this.path.join('.')] = this;
    }

    // Public methods

    /**
     * Processes an enitre input line
     *
     * @param {String} line Entire input line as 'binary' string
     */
    MimeNode.prototype.writeLine = function(line) {
        if (this._state === 'HEADER') {
            this._processHeaderLine(line);
        } else if (this._state === 'BODY') {
            this._processBodyLine(line);
        }
    };

    /**
     * Processes any remainders
     */
    MimeNode.prototype.finalize = function() {
        if (this._isRfc822) {
            this._currentChild.finalize();
        } else {
            this._emitBody(true);
        }
    };

    // Private methods

    /**
     * Processes a line in the HEADER state. It the line is empty, change state to BODY
     *
     * @param {String} line Entire input line as 'binary' string
     */
    MimeNode.prototype._processHeaderLine = function(line) {
        if (!line) {
            this._parseHeaders();
            this._parser.onheader(this);
            this._state = 'BODY';
            return;
        }

        if (line.match(/^\s/) && this.header.length) {
            this.header[this.header.length - 1] += '\n' + line;
        } else {
            this.header.push(line);
        }
    };

    /**
     * Joins folded header lines and calls Content-Type and Transfer-Encoding processors
     */
    MimeNode.prototype._parseHeaders = function() {

        // Join header lines
        var key, value;

        for (var i = 0, len = this.header.length; i < len; i++) {
            value = this.header[i].split(':');
            key = (value.shift() || '').trim().toLowerCase();
            value = (value.join(':') || '').replace(/\n/g, '').trim();

            if (!this.headers[key]) {
                this.headers[key] = [value];
            } else {
                this.headers[key].push(value);
            }
        }

        this._processContentType();
        this._processContentTransferEncoding();
    };

    /**
     * Parses Content-Type value and selects following actions.
     */
    MimeNode.prototype._processContentType = function() {
        var contentDisposition;

        this.contentType = mimefuncs.parseHeaderValue(
            this.headers['content-type'] && this.headers['content-type'][0] || 'text/plain');
        this.contentType.value = (this.contentType.value || '').toLowerCase().trim();
        this.contentType.type = (this.contentType.value.split('/').shift() || 'text');

        if (this.contentType.type === 'multipart' && this.contentType.params.boundary) {
            this._childNodes = [];
            this._isMultipart = (this.contentType.value.split('/').pop() || 'mixed');
            this._multipartBoundary = this.contentType.params.boundary;
        }

        if (this.contentType.value === 'message/rfc822') {
            /**
             * Parse message/rfc822 only if the mime part is not marked with content-disposition: attachment,
             * otherwise treat it like a regular attachment
             */
            contentDisposition = mimefuncs.parseHeaderValue(
                this.headers['content-disposition'] && this.headers['content-disposition'][0] || '');
            if ((contentDisposition.value || '').toLowerCase().trim() !== 'attachment') {
                this._childNodes = [];
                this._currentChild = new MimeNode(this, this._parser);
                this._childNodes.push(this._currentChild);
                this._isRfc822 = true;
            }
        }
    };

    /**
     * Parses Content-Trasnfer-Encoding value to see if the body needs to be converted
     * before it can be emitted
     */
    MimeNode.prototype._processContentTransferEncoding = function() {
        this.contentTransferEncoding = mimefuncs.parseHeaderValue(
            this.headers['content-transfer-encoding'] && this.headers['content-transfer-encoding'][0] || '7bit');
        this.contentTransferEncoding.value = (this.contentTransferEncoding.value || '').toLowerCase().trim();
    };

    /**
     * Processes a line in the BODY state. If this is a multipart or rfc822 node,
     * passes line value to child nodes.
     *
     * @param {String} line Entire input line as 'binary' string
     */
    MimeNode.prototype._processBodyLine = function(line) {
        var curLine, match;

        this._lineCount++;

        if (this._isMultipart) {
            if (line === '--' + this._multipartBoundary) {
                if (this._currentChild) {
                    this._currentChild.finalize();
                }
                this._currentChild = new MimeNode(this, this._parser);
                this._childNodes.push(this._currentChild);
            } else if (line === '--' + this._multipartBoundary + '--') {
                if (this._currentChild) {
                    this._currentChild.finalize();
                }
                this._currentChild = false;
            } else if (this._currentChild) {
                this._currentChild.writeLine(line);
            } else {
                // Ignore body for multipart
            }
        } else if (this._isRfc822) {
            this._currentChild.writeLine(line);
        } else {
            switch (this.contentTransferEncoding.value) {
                case 'base64':
                    curLine = this._lineRemainder + line.trim();

                    if (curLine.length % 4) {
                        this._lineRemainder = curLine.substr(-curLine.length % 4);
                        curLine = curLine.substr(0, curLine.length - this._lineRemainder.length);
                    } else {
                        this._lineRemainder = '';
                    }

                    if (curLine.length) {
                        this._bodyBuffer += mimefuncs.fromArrayBuffer(mimefuncs.base64.decode(curLine));
                    }

                    break;
                case 'quoted-printable':
                    curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line;
                    if ((match = curLine.match(/=[a-f0-9]{0,1}$/i))) {
                        this._lineRemainder = match[0];
                        curLine = curLine.substr(0, curLine.length - this._lineRemainder.length);
                    }

                    this._bodyBuffer += curLine.replace(/=([a-f0-9]{2})/ig, function(m, code) {
                        return String.fromCharCode(parseInt(code, 16));
                    });
                    break;
                    // case '7bit':
                    // case '8bit':
                default:
                    this._bodyBuffer += (this._lineCount > 1 ? '\n' : '') + line;
                    break;
            }
        }
    };

    /**
     * Emits a chunk of the body
     *
     * @param {Boolean} forceEmit If set to true does not keep any remainders
     */
    MimeNode.prototype._emitBody = function() {
        if (this._isMultipart || !this._bodyBuffer) {
            return;
        }

        this.content = mimefuncs.toArrayBuffer(this._bodyBuffer);
        this._bodyBuffer = '';
        this._parser.onbody(this, this.content);
    };

    return MimeParser;
}));
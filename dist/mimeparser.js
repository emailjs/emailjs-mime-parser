'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MimeNode = exports.NodeCounter = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

exports.default = parse;

var _ramda = require('ramda');

var _timezones = require('./timezones');

var _timezones2 = _interopRequireDefault(_timezones);

var _emailjsMimeCodec = require('emailjs-mime-codec');

var _textEncoding = require('text-encoding');

var _emailjsAddressparser = require('emailjs-addressparser');

var _emailjsAddressparser2 = _interopRequireDefault(_emailjsAddressparser);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

/*
 * Counts MIME nodes to prevent memory exhaustion attacks (CWE-400)
 * see: https://snyk.io/vuln/npm:emailjs-mime-parser:20180625
 */
var MAXIMUM_NUMBER_OF_MIME_NODES = 999;

var NodeCounter = exports.NodeCounter = function () {
  function NodeCounter() {
    _classCallCheck(this, NodeCounter);

    this.count = 0;
  }

  _createClass(NodeCounter, [{
    key: 'bump',
    value: function bump() {
      if (++this.count > MAXIMUM_NUMBER_OF_MIME_NODES) {
        throw new Error('Maximum number of MIME nodes exceeded!');
      }
    }
  }]);

  return NodeCounter;
}();

function forEachLine(str, callback) {
  var line = '';
  var terminator = '';
  for (var i = 0; i < str.length; i += 1) {
    var char = str[i];
    if (char === '\r' || char === '\n') {
      var nextChar = str[i + 1];
      terminator += char;
      // Detect Windows and Macintosh line terminators.
      if (terminator + nextChar === '\r\n' || terminator + nextChar === '\n\r') {
        callback(line, terminator + nextChar);
        line = '';
        terminator = '';
        i += 1;
        // Detect single-character terminators, like Linux or other system.
      } else if (terminator === '\n' || terminator === '\r') {
        callback(line, terminator);
        line = '';
        terminator = '';
      }
    } else {
      line += char;
    }
  }
  // Flush the line and terminator values if necessary; handle edge cases where MIME is generated without last line terminator.
  if (line !== '' || terminator !== '') {
    callback(line, terminator);
  }
}

function parse(chunk) {
  var root = new MimeNode(new NodeCounter());
  var str = typeof chunk === 'string' ? chunk : String.fromCharCode.apply(null, chunk);
  forEachLine(str, function (line, terminator) {
    root.writeLine(line, terminator);
  });
  root.finalize();
  return root;
}

var MimeNode = exports.MimeNode = function () {
  function MimeNode() {
    var nodeCounter = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : new NodeCounter();

    _classCallCheck(this, MimeNode);

    this.nodeCounter = nodeCounter;
    this.nodeCounter.bump();

    this.header = []; // An array of unfolded header lines
    this.headers = {}; // An object that holds header key=value pairs
    this.bodystructure = '';
    this.childNodes = []; // If this is a multipart or message/rfc822 mime part, the value will be converted to array and hold all child nodes for this node
    this.raw = ''; // Stores the raw content of this node

    this._state = 'HEADER'; // Current state, always starts out with HEADER
    this._bodyBuffer = ''; // Body buffer
    this._lineCount = 0; // Line counter bor the body part
    this._currentChild = false; // Active child node (if available)
    this._lineRemainder = ''; // Remainder string when dealing with base64 and qp values
    this._isMultipart = false; // Indicates if this is a multipart node
    this._multipartBoundary = false; // Stores boundary value for current multipart node
    this._isRfc822 = false; // Indicates if this is a message/rfc822 node
  }

  _createClass(MimeNode, [{
    key: 'writeLine',
    value: function writeLine(line, terminator) {
      this.raw += line + (terminator || '\n');

      if (this._state === 'HEADER') {
        this._processHeaderLine(line);
      } else if (this._state === 'BODY') {
        this._processBodyLine(line, terminator);
      }
    }
  }, {
    key: 'finalize',
    value: function finalize() {
      var _this = this;

      if (this._isRfc822) {
        this._currentChild.finalize();
      } else {
        this._emitBody();
      }

      this.bodystructure = this.childNodes.reduce(function (agg, child) {
        return agg + '--' + _this._multipartBoundary + '\n' + child.bodystructure;
      }, this.header.join('\n') + '\n\n') + (this._multipartBoundary ? '--' + this._multipartBoundary + '--\n' : '');
    }
  }, {
    key: '_decodeBodyBuffer',
    value: function _decodeBodyBuffer() {
      switch (this.contentTransferEncoding.value) {
        case 'base64':
          this._bodyBuffer = (0, _emailjsMimeCodec.base64Decode)(this._bodyBuffer, this.charset);
          break;
        case 'quoted-printable':
          {
            this._bodyBuffer = this._bodyBuffer.replace(/=(\r?\n|$)/g, '').replace(/=([a-f0-9]{2})/ig, function (m, code) {
              return String.fromCharCode(parseInt(code, 16));
            });
            break;
          }
      }
    }

    /**
     * Processes a line in the HEADER state. It the line is empty, change state to BODY
     *
     * @param {String} line Entire input line as 'binary' string
     */

  }, {
    key: '_processHeaderLine',
    value: function _processHeaderLine(line) {
      if (!line) {
        this._parseHeaders();
        this.bodystructure += this.header.join('\n') + '\n\n';
        this._state = 'BODY';
        return;
      }

      if (line.match(/^\s/) && this.header.length) {
        this.header[this.header.length - 1] += '\n' + line;
      } else {
        this.header.push(line);
      }
    }

    /**
     * Joins folded header lines and calls Content-Type and Transfer-Encoding processors
     */

  }, {
    key: '_parseHeaders',
    value: function _parseHeaders() {
      for (var hasBinary = false, i = 0, len = this.header.length; i < len; i++) {
        var value = this.header[i].split(':');
        var key = (value.shift() || '').trim().toLowerCase();
        value = (value.join(':') || '').replace(/\n/g, '').trim();

        if (value.match(/[\u0080-\uFFFF]/)) {
          if (!this.charset) {
            hasBinary = true;
          }
          // use default charset at first and if the actual charset is resolved, the conversion is re-run
          value = (0, _emailjsMimeCodec.decode)((0, _emailjsMimeCodec.convert)(str2arr(value), this.charset || 'iso-8859-1'));
        }

        this.headers[key] = (this.headers[key] || []).concat([this._parseHeaderValue(key, value)]);

        if (!this.charset && key === 'content-type') {
          this.charset = this.headers[key][this.headers[key].length - 1].params.charset;
        }

        if (hasBinary && this.charset) {
          // reset values and start over once charset has been resolved and 8bit content has been found
          hasBinary = false;
          this.headers = {};
          i = -1; // next iteration has i == 0
        }
      }

      this.fetchContentType();
      this._processContentTransferEncoding();
    }

    /**
     * Parses single header value
     * @param {String} key Header key
     * @param {String} value Value for the key
     * @return {Object} parsed header
     */

  }, {
    key: '_parseHeaderValue',
    value: function _parseHeaderValue(key, value) {
      var parsedValue = void 0;
      var isAddress = false;

      switch (key) {
        case 'content-type':
        case 'content-transfer-encoding':
        case 'content-disposition':
        case 'dkim-signature':
          parsedValue = (0, _emailjsMimeCodec.parseHeaderValue)(value);
          break;
        case 'from':
        case 'sender':
        case 'to':
        case 'reply-to':
        case 'cc':
        case 'bcc':
        case 'abuse-reports-to':
        case 'errors-to':
        case 'return-path':
        case 'delivered-to':
          isAddress = true;
          parsedValue = {
            value: [].concat((0, _emailjsAddressparser2.default)(value) || [])
          };
          break;
        case 'date':
          parsedValue = {
            value: this._parseDate(value)
          };
          break;
        default:
          parsedValue = {
            value: value
          };
      }
      parsedValue.initial = value;

      this._decodeHeaderCharset(parsedValue, { isAddress: isAddress });

      return parsedValue;
    }

    /**
     * Checks if a date string can be parsed. Falls back replacing timezone
     * abbrevations with timezone values. Bogus timezones default to UTC.
     *
     * @param {String} str Date header
     * @returns {String} UTC date string if parsing succeeded, otherwise returns input value
     */

  }, {
    key: '_parseDate',
    value: function _parseDate() {
      var str = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';

      var date = new Date(str.trim().replace(/\b[a-z]+$/i, function (tz) {
        return _timezones2.default[tz.toUpperCase()] || '+0000';
      }));
      return date.toString() !== 'Invalid Date' ? date.toUTCString().replace(/GMT/, '+0000') : str;
    }
  }, {
    key: '_decodeHeaderCharset',
    value: function _decodeHeaderCharset(parsed) {
      var _this2 = this;

      var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          isAddress = _ref.isAddress;

      // decode default value
      if (typeof parsed.value === 'string') {
        parsed.value = (0, _emailjsMimeCodec.mimeWordsDecode)(parsed.value);
      }

      // decode possible params
      Object.keys(parsed.params || {}).forEach(function (key) {
        if (typeof parsed.params[key] === 'string') {
          parsed.params[key] = (0, _emailjsMimeCodec.mimeWordsDecode)(parsed.params[key]);
        }
      });

      // decode addresses
      if (isAddress && Array.isArray(parsed.value)) {
        parsed.value.forEach(function (addr) {
          if (addr.name) {
            addr.name = (0, _emailjsMimeCodec.mimeWordsDecode)(addr.name);
            if (Array.isArray(addr.group)) {
              _this2._decodeHeaderCharset({ value: addr.group }, { isAddress: true });
            }
          }
        });
      }

      return parsed;
    }

    /**
     * Parses Content-Type value and selects following actions.
     */

  }, {
    key: 'fetchContentType',
    value: function fetchContentType() {
      var defaultValue = (0, _emailjsMimeCodec.parseHeaderValue)('text/plain');
      this.contentType = (0, _ramda.pathOr)(defaultValue, ['headers', 'content-type', '0'])(this);
      this.contentType.value = (this.contentType.value || '').toLowerCase().trim();
      this.contentType.type = this.contentType.value.split('/').shift() || 'text';

      if (this.contentType.params && this.contentType.params.charset && !this.charset) {
        this.charset = this.contentType.params.charset;
      }

      if (this.contentType.type === 'multipart' && this.contentType.params.boundary) {
        this.childNodes = [];
        this._isMultipart = this.contentType.value.split('/').pop() || 'mixed';
        this._multipartBoundary = this.contentType.params.boundary;
      }

      /**
       * For attachment (inline/regular) if charset is not defined and attachment is non-text/*,
       * then default charset to binary.
       * Refer to issue: https://github.com/emailjs/emailjs-mime-parser/issues/18
       */
      var defaultContentDispositionValue = (0, _emailjsMimeCodec.parseHeaderValue)('');
      var contentDisposition = (0, _ramda.pathOr)(defaultContentDispositionValue, ['headers', 'content-disposition', '0'])(this);
      var isAttachment = (contentDisposition.value || '').toLowerCase().trim() === 'attachment';
      var isInlineAttachment = (contentDisposition.value || '').toLowerCase().trim() === 'inline';
      if ((isAttachment || isInlineAttachment) && this.contentType.type !== 'text' && !this.charset) {
        this.charset = 'binary';
      }

      if (this.contentType.value === 'message/rfc822' && !isAttachment) {
        /**
         * Parse message/rfc822 only if the mime part is not marked with content-disposition: attachment,
         * otherwise treat it like a regular attachment
         */
        this._currentChild = new MimeNode(this.nodeCounter);
        this.childNodes = [this._currentChild];
        this._isRfc822 = true;
      }
    }

    /**
     * Parses Content-Transfer-Encoding value to see if the body needs to be converted
     * before it can be emitted
     */

  }, {
    key: '_processContentTransferEncoding',
    value: function _processContentTransferEncoding() {
      var defaultValue = (0, _emailjsMimeCodec.parseHeaderValue)('7bit');
      this.contentTransferEncoding = (0, _ramda.pathOr)(defaultValue, ['headers', 'content-transfer-encoding', '0'])(this);
      this.contentTransferEncoding.value = (0, _ramda.pathOr)('', ['contentTransferEncoding', 'value'])(this).toLowerCase().trim();
    }

    /**
     * Processes a line in the BODY state. If this is a multipart or rfc822 node,
     * passes line value to child nodes.
     *
     * @param {String} line Entire input line as 'binary' string
     * @param {String} terminator The line terminator detected by parser
     */

  }, {
    key: '_processBodyLine',
    value: function _processBodyLine(line, terminator) {
      if (this._isMultipart) {
        if (line === '--' + this._multipartBoundary) {
          this.bodystructure += line + '\n';
          if (this._currentChild) {
            this._currentChild.finalize();
          }
          this._currentChild = new MimeNode(this.nodeCounter);
          this.childNodes.push(this._currentChild);
        } else if (line === '--' + this._multipartBoundary + '--') {
          this.bodystructure += line + '\n';
          if (this._currentChild) {
            this._currentChild.finalize();
          }
          this._currentChild = false;
        } else if (this._currentChild) {
          this._currentChild.writeLine(line, terminator);
        } else {
          // Ignore multipart preamble
        }
      } else if (this._isRfc822) {
        this._currentChild.writeLine(line, terminator);
      } else {
        this._lineCount++;

        switch (this.contentTransferEncoding.value) {
          case 'base64':
            this._bodyBuffer += line + terminator;
            break;
          case 'quoted-printable':
            {
              var curLine = this._lineRemainder + line + terminator;
              var match = curLine.match(/=[a-f0-9]{0,1}$/i);
              if (match) {
                this._lineRemainder = match[0];
                curLine = curLine.substr(0, curLine.length - this._lineRemainder.length);
              } else {
                this._lineRemainder = '';
              }
              this._bodyBuffer += curLine;
              break;
            }
          case '7bit':
          case '8bit':
          default:
            this._bodyBuffer += line + terminator;
            break;
        }
      }
    }

    /**
     * Emits a chunk of the body
    */

  }, {
    key: '_emitBody',
    value: function _emitBody() {
      this._decodeBodyBuffer();
      if (this._isMultipart || !this._bodyBuffer) {
        return;
      }

      this._processFlowedText();
      this.content = str2arr(this._bodyBuffer);
      this._processHtmlText();
      this._bodyBuffer = '';
    }
  }, {
    key: '_processFlowedText',
    value: function _processFlowedText() {
      var isText = /^text\/(plain|html)$/i.test(this.contentType.value);
      var isFlowed = /^flowed$/i.test((0, _ramda.pathOr)('', ['contentType', 'params', 'format'])(this));
      if (!isText || !isFlowed) return;

      var delSp = /^yes$/i.test(this.contentType.params.delsp);
      var bodyBuffer = '';

      forEachLine(this._bodyBuffer, function (line, terminator) {
        var endsWithSpace = / $/.test(line);
        var isBoundary = /(^|\n)-- $/.test(line);

        bodyBuffer += (delSp ? line.replace(/[ ]+$/, '') : line) + (endsWithSpace && !isBoundary ? '' : terminator);
      });

      this._bodyBuffer = bodyBuffer.replace(/^ /gm, ''); // remove whitespace stuffing http://tools.ietf.org/html/rfc3676#section-4.4
    }
  }, {
    key: '_processHtmlText',
    value: function _processHtmlText() {
      var contentDisposition = this.headers['content-disposition'] && this.headers['content-disposition'][0] || (0, _emailjsMimeCodec.parseHeaderValue)('');
      var isHtml = /^text\/(plain|html)$/i.test(this.contentType.value);
      var isAttachment = /^attachment$/i.test(contentDisposition.value);
      if (isHtml && !isAttachment) {
        if (!this.charset && /^text\/html$/i.test(this.contentType.value)) {
          this.charset = this.detectHTMLCharset(this._bodyBuffer);
        }

        // decode "binary" string to an unicode string
        if (!/^utf[-_]?8$/i.test(this.charset)) {
          this.content = (0, _emailjsMimeCodec.convert)(str2arr(this._bodyBuffer), this.charset || 'iso-8859-1');
        } else if (this.contentTransferEncoding.value === 'base64') {
          this.content = utf8Str2arr(this._bodyBuffer);
        }

        // override charset for text nodes
        this.charset = this.contentType.params.charset = 'utf-8';
      }
    }

    /**
     * Detect charset from a html file
     *
     * @param {String} html Input HTML
     * @returns {String} Charset if found or undefined
     */

  }, {
    key: 'detectHTMLCharset',
    value: function detectHTMLCharset(html) {
      var charset = void 0,
          input = void 0;

      html = html.replace(/\r?\n|\r/g, ' ');
      var meta = html.match(/<meta\s+http-equiv=["'\s]*content-type[^>]*?>/i);
      if (meta) {
        input = meta[0];
      }

      if (input) {
        charset = input.match(/charset\s?=\s?([a-zA-Z\-_:0-9]*);?/);
        if (charset) {
          charset = (charset[1] || '').trim().toLowerCase();
        }
      }

      meta = html.match(/<meta\s+charset=["'\s]*([^"'<>/\s]+)/i);
      if (!charset && meta) {
        charset = (meta[1] || '').trim().toLowerCase();
      }

      return charset;
    }
  }]);

  return MimeNode;
}();

var str2arr = function str2arr(str) {
  return new Uint8Array(str.split('').map(function (char) {
    return char.charCodeAt(0);
  }));
};
var utf8Str2arr = function utf8Str2arr(str) {
  return new _textEncoding.TextEncoder('utf-8').encode(str);
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taW1lcGFyc2VyLmpzIl0sIm5hbWVzIjpbInBhcnNlIiwiTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUyIsIk5vZGVDb3VudGVyIiwiY291bnQiLCJFcnJvciIsImZvckVhY2hMaW5lIiwic3RyIiwiY2FsbGJhY2siLCJsaW5lIiwidGVybWluYXRvciIsImkiLCJsZW5ndGgiLCJjaGFyIiwibmV4dENoYXIiLCJjaHVuayIsInJvb3QiLCJNaW1lTm9kZSIsIlN0cmluZyIsImZyb21DaGFyQ29kZSIsImFwcGx5Iiwid3JpdGVMaW5lIiwiZmluYWxpemUiLCJub2RlQ291bnRlciIsImJ1bXAiLCJoZWFkZXIiLCJoZWFkZXJzIiwiYm9keXN0cnVjdHVyZSIsImNoaWxkTm9kZXMiLCJyYXciLCJfc3RhdGUiLCJfYm9keUJ1ZmZlciIsIl9saW5lQ291bnQiLCJfY3VycmVudENoaWxkIiwiX2xpbmVSZW1haW5kZXIiLCJfaXNNdWx0aXBhcnQiLCJfbXVsdGlwYXJ0Qm91bmRhcnkiLCJfaXNSZmM4MjIiLCJfcHJvY2Vzc0hlYWRlckxpbmUiLCJfcHJvY2Vzc0JvZHlMaW5lIiwiX2VtaXRCb2R5IiwicmVkdWNlIiwiYWdnIiwiY2hpbGQiLCJqb2luIiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ2YWx1ZSIsImNoYXJzZXQiLCJyZXBsYWNlIiwibSIsImNvZGUiLCJwYXJzZUludCIsIl9wYXJzZUhlYWRlcnMiLCJtYXRjaCIsInB1c2giLCJoYXNCaW5hcnkiLCJsZW4iLCJzcGxpdCIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwic3RyMmFyciIsImNvbmNhdCIsIl9wYXJzZUhlYWRlclZhbHVlIiwicGFyYW1zIiwiZmV0Y2hDb250ZW50VHlwZSIsIl9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJwYXJzZWRWYWx1ZSIsImlzQWRkcmVzcyIsIl9wYXJzZURhdGUiLCJpbml0aWFsIiwiX2RlY29kZUhlYWRlckNoYXJzZXQiLCJkYXRlIiwiRGF0ZSIsInRpbWV6b25lIiwidHoiLCJ0b1VwcGVyQ2FzZSIsInRvU3RyaW5nIiwidG9VVENTdHJpbmciLCJwYXJzZWQiLCJPYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsIkFycmF5IiwiaXNBcnJheSIsImFkZHIiLCJuYW1lIiwiZ3JvdXAiLCJkZWZhdWx0VmFsdWUiLCJjb250ZW50VHlwZSIsInR5cGUiLCJib3VuZGFyeSIsInBvcCIsImRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSIsImNvbnRlbnREaXNwb3NpdGlvbiIsImlzQXR0YWNobWVudCIsImlzSW5saW5lQXR0YWNobWVudCIsImN1ckxpbmUiLCJzdWJzdHIiLCJfZGVjb2RlQm9keUJ1ZmZlciIsIl9wcm9jZXNzRmxvd2VkVGV4dCIsImNvbnRlbnQiLCJfcHJvY2Vzc0h0bWxUZXh0IiwiaXNUZXh0IiwidGVzdCIsImlzRmxvd2VkIiwiZGVsU3AiLCJkZWxzcCIsImJvZHlCdWZmZXIiLCJlbmRzV2l0aFNwYWNlIiwiaXNCb3VuZGFyeSIsImlzSHRtbCIsImRldGVjdEhUTUxDaGFyc2V0IiwidXRmOFN0cjJhcnIiLCJodG1sIiwiaW5wdXQiLCJtZXRhIiwiVWludDhBcnJheSIsIm1hcCIsImNoYXJDb2RlQXQiLCJUZXh0RW5jb2RlciIsImVuY29kZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O2tCQW9Ed0JBLEs7O0FBcER4Qjs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOzs7Ozs7OztBQUVBOzs7O0FBSUEsSUFBTUMsK0JBQStCLEdBQXJDOztJQUNhQyxXLFdBQUFBLFc7QUFDWCx5QkFBZTtBQUFBOztBQUNiLFNBQUtDLEtBQUwsR0FBYSxDQUFiO0FBQ0Q7Ozs7MkJBQ087QUFDTixVQUFJLEVBQUUsS0FBS0EsS0FBUCxHQUFlRiw0QkFBbkIsRUFBaUQ7QUFDL0MsY0FBTSxJQUFJRyxLQUFKLENBQVUsd0NBQVYsQ0FBTjtBQUNEO0FBQ0Y7Ozs7OztBQUdILFNBQVNDLFdBQVQsQ0FBc0JDLEdBQXRCLEVBQTJCQyxR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O0FBQUEsQ0FBcEIiLCJmaWxlIjoibWltZXBhcnNlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhdGhPciB9IGZyb20gJ3JhbWRhJ1xuaW1wb3J0IHRpbWV6b25lIGZyb20gJy4vdGltZXpvbmVzJ1xuaW1wb3J0IHsgZGVjb2RlLCBiYXNlNjREZWNvZGUsIGNvbnZlcnQsIHBhcnNlSGVhZGVyVmFsdWUsIG1pbWVXb3Jkc0RlY29kZSB9IGZyb20gJ2VtYWlsanMtbWltZS1jb2RlYydcbmltcG9ydCB7IFRleHRFbmNvZGVyIH0gZnJvbSAndGV4dC1lbmNvZGluZydcbmltcG9ydCBwYXJzZUFkZHJlc3MgZnJvbSAnZW1haWxqcy1hZGRyZXNzcGFyc2VyJ1xuXG4vKlxuICogQ291bnRzIE1JTUUgbm9kZXMgdG8gcHJldmVudCBtZW1vcnkgZXhoYXVzdGlvbiBhdHRhY2tzIChDV0UtNDAwKVxuICogc2VlOiBodHRwczovL3NueWsuaW8vdnVsbi9ucG06ZW1haWxqcy1taW1lLXBhcnNlcjoyMDE4MDYyNVxuICovXG5jb25zdCBNQVhJTVVNX05VTUJFUl9PRl9NSU1FX05PREVTID0gOTk5XG5leHBvcnQgY2xhc3MgTm9kZUNvdW50ZXIge1xuICBjb25zdHJ1Y3RvciAoKSB7XG4gICAgdGhpcy5jb3VudCA9IDBcbiAgfVxuICBidW1wICgpIHtcbiAgICBpZiAoKyt0aGlzLmNvdW50ID4gTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNYXhpbXVtIG51bWJlciBvZiBNSU1FIG5vZGVzIGV4Y2VlZGVkIScpXG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGZvckVhY2hMaW5lIChzdHIsIGNhbGxiYWNrKSB7XG4gIGxldCBsaW5lID0gJydcbiAgbGV0IHRlcm1pbmF0b3IgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGNoYXIgPSBzdHJbaV1cbiAgICBpZiAoY2hhciA9PT0gJ1xccicgfHwgY2hhciA9PT0gJ1xcbicpIHtcbiAgICAgIGNvbnN0IG5leHRDaGFyID0gc3RyW2kgKyAxXVxuICAgICAgdGVybWluYXRvciArPSBjaGFyXG4gICAgICAvLyBEZXRlY3QgV2luZG93cyBhbmQgTWFjaW50b3NoIGxpbmUgdGVybWluYXRvcnMuXG4gICAgICBpZiAoKHRlcm1pbmF0b3IgKyBuZXh0Q2hhcikgPT09ICdcXHJcXG4nIHx8ICh0ZXJtaW5hdG9yICsgbmV4dENoYXIpID09PSAnXFxuXFxyJykge1xuICAgICAgICBjYWxsYmFjayhsaW5lLCB0ZXJtaW5hdG9yICsgbmV4dENoYXIpXG4gICAgICAgIGxpbmUgPSAnJ1xuICAgICAgICB0ZXJtaW5hdG9yID0gJydcbiAgICAgICAgaSArPSAxXG4gICAgICAvLyBEZXRlY3Qgc2luZ2xlLWNoYXJhY3RlciB0ZXJtaW5hdG9ycywgbGlrZSBMaW51eCBvciBvdGhlciBzeXN0ZW0uXG4gICAgICB9IGVsc2UgaWYgKHRlcm1pbmF0b3IgPT09ICdcXG4nIHx8IHRlcm1pbmF0b3IgPT09ICdcXHInKSB7XG4gICAgICAgIGNhbGxiYWNrKGxpbmUsIHRlcm1pbmF0b3IpXG4gICAgICAgIGxpbmUgPSAnJ1xuICAgICAgICB0ZXJtaW5hdG9yID0gJydcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbGluZSArPSBjaGFyXG4gICAgfVxuICB9XG4gIC8vIEZsdXNoIHRoZSBsaW5lIGFuZCB0ZXJtaW5hdG9yIHZhbHVlcyBpZiBuZWNlc3Nhcnk7IGhhbmRsZSBlZGdlIGNhc2VzIHdoZXJlIE1JTUUgaXMgZ2VuZXJhdGVkIHdpdGhvdXQgbGFzdCBsaW5lIHRlcm1pbmF0b3IuXG4gIGlmIChsaW5lICE9PSAnJyB8fCB0ZXJtaW5hdG9yICE9PSAnJykge1xuICAgIGNhbGxiYWNrKGxpbmUsIHRlcm1pbmF0b3IpXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gcGFyc2UgKGNodW5rKSB7XG4gIGNvbnN0IHJvb3QgPSBuZXcgTWltZU5vZGUobmV3IE5vZGVDb3VudGVyKCkpXG4gIGNvbnN0IHN0ciA9IHR5cGVvZiBjaHVuayA9PT0gJ3N0cmluZycgPyBjaHVuayA6IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkobnVsbCwgY2h1bmspXG4gIGZvckVhY2hMaW5lKHN0ciwgZnVuY3Rpb24gKGxpbmUsIHRlcm1pbmF0b3IpIHtcbiAgICByb290LndyaXRlTGluZShsaW5lLCB0ZXJtaW5hdG9yKVxuICB9KVxuICByb290LmZpbmFsaXplKClcbiAgcmV0dXJuIHJvb3Rcbn1cblxuZXhwb3J0IGNsYXNzIE1pbWVOb2RlIHtcbiAgY29uc3RydWN0b3IgKG5vZGVDb3VudGVyID0gbmV3IE5vZGVDb3VudGVyKCkpIHtcbiAgICB0aGlzLm5vZGVDb3VudGVyID0gbm9kZUNvdW50ZXJcbiAgICB0aGlzLm5vZGVDb3VudGVyLmJ1bXAoKVxuXG4gICAgdGhpcy5oZWFkZXIgPSBbXSAvLyBBbiBhcnJheSBvZiB1bmZvbGRlZCBoZWFkZXIgbGluZXNcbiAgICB0aGlzLmhlYWRlcnMgPSB7fSAvLyBBbiBvYmplY3QgdGhhdCBob2xkcyBoZWFkZXIga2V5PXZhbHVlIHBhaXJzXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gJydcbiAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXSAvLyBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIG1lc3NhZ2UvcmZjODIyIG1pbWUgcGFydCwgdGhlIHZhbHVlIHdpbGwgYmUgY29udmVydGVkIHRvIGFycmF5IGFuZCBob2xkIGFsbCBjaGlsZCBub2RlcyBmb3IgdGhpcyBub2RlXG4gICAgdGhpcy5yYXcgPSAnJyAvLyBTdG9yZXMgdGhlIHJhdyBjb250ZW50IG9mIHRoaXMgbm9kZVxuXG4gICAgdGhpcy5fc3RhdGUgPSAnSEVBREVSJyAvLyBDdXJyZW50IHN0YXRlLCBhbHdheXMgc3RhcnRzIG91dCB3aXRoIEhFQURFUlxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJyAvLyBCb2R5IGJ1ZmZlclxuICAgIHRoaXMuX2xpbmVDb3VudCA9IDAgLy8gTGluZSBjb3VudGVyIGJvciB0aGUgYm9keSBwYXJ0XG4gICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2UgLy8gQWN0aXZlIGNoaWxkIG5vZGUgKGlmIGF2YWlsYWJsZSlcbiAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJycgLy8gUmVtYWluZGVyIHN0cmluZyB3aGVuIGRlYWxpbmcgd2l0aCBiYXNlNjQgYW5kIHFwIHZhbHVlc1xuICAgIHRoaXMuX2lzTXVsdGlwYXJ0ID0gZmFsc2UgLy8gSW5kaWNhdGVzIGlmIHRoaXMgaXMgYSBtdWx0aXBhcnQgbm9kZVxuICAgIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID0gZmFsc2UgLy8gU3RvcmVzIGJvdW5kYXJ5IHZhbHVlIGZvciBjdXJyZW50IG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5faXNSZmM4MjIgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG1lc3NhZ2UvcmZjODIyIG5vZGVcbiAgfVxuXG4gIHdyaXRlTGluZSAobGluZSwgdGVybWluYXRvcikge1xuICAgIHRoaXMucmF3ICs9IGxpbmUgKyAodGVybWluYXRvciB8fCAnXFxuJylcblxuICAgIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0hFQURFUicpIHtcbiAgICAgIHRoaXMuX3Byb2Nlc3NIZWFkZXJMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0JPRFknKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzQm9keUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgICB9XG4gIH1cblxuICBmaW5hbGl6ZSAoKSB7XG4gICAgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9lbWl0Qm9keSgpXG4gICAgfVxuXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gdGhpcy5jaGlsZE5vZGVzXG4gICAgICAucmVkdWNlKChhZ2csIGNoaWxkKSA9PiBhZ2cgKyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnXFxuJyArIGNoaWxkLmJvZHlzdHJ1Y3R1cmUsIHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbicpICtcbiAgICAgICh0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA/ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICctLVxcbicgOiAnJylcbiAgfVxuXG4gIF9kZWNvZGVCb2R5QnVmZmVyICgpIHtcbiAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgPSBiYXNlNjREZWNvZGUodGhpcy5fYm9keUJ1ZmZlciwgdGhpcy5jaGFyc2V0KVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6IHtcbiAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciA9IHRoaXMuX2JvZHlCdWZmZXJcbiAgICAgICAgICAucmVwbGFjZSgvPShcXHI/XFxufCQpL2csICcnKVxuICAgICAgICAgIC5yZXBsYWNlKC89KFthLWYwLTldezJ9KS9pZywgKG0sIGNvZGUpID0+IFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoY29kZSwgMTYpKSlcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgSEVBREVSIHN0YXRlLiBJdCB0aGUgbGluZSBpcyBlbXB0eSwgY2hhbmdlIHN0YXRlIHRvIEJPRFlcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0hlYWRlckxpbmUgKGxpbmUpIHtcbiAgICBpZiAoIWxpbmUpIHtcbiAgICAgIHRoaXMuX3BhcnNlSGVhZGVycygpXG4gICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJ1xuICAgICAgdGhpcy5fc3RhdGUgPSAnQk9EWSdcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChsaW5lLm1hdGNoKC9eXFxzLykgJiYgdGhpcy5oZWFkZXIubGVuZ3RoKSB7XG4gICAgICB0aGlzLmhlYWRlclt0aGlzLmhlYWRlci5sZW5ndGggLSAxXSArPSAnXFxuJyArIGxpbmVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5oZWFkZXIucHVzaChsaW5lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBmb2xkZWQgaGVhZGVyIGxpbmVzIGFuZCBjYWxscyBDb250ZW50LVR5cGUgYW5kIFRyYW5zZmVyLUVuY29kaW5nIHByb2Nlc3NvcnNcbiAgICovXG4gIF9wYXJzZUhlYWRlcnMgKCkge1xuICAgIGZvciAobGV0IGhhc0JpbmFyeSA9IGZhbHNlLCBpID0gMCwgbGVuID0gdGhpcy5oZWFkZXIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGxldCB2YWx1ZSA9IHRoaXMuaGVhZGVyW2ldLnNwbGl0KCc6JylcbiAgICAgIGNvbnN0IGtleSA9ICh2YWx1ZS5zaGlmdCgpIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgdmFsdWUgPSAodmFsdWUuam9pbignOicpIHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJycpLnRyaW0oKVxuXG4gICAgICBpZiAodmFsdWUubWF0Y2goL1tcXHUwMDgwLVxcdUZGRkZdLykpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgICBoYXNCaW5hcnkgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgLy8gdXNlIGRlZmF1bHQgY2hhcnNldCBhdCBmaXJzdCBhbmQgaWYgdGhlIGFjdHVhbCBjaGFyc2V0IGlzIHJlc29sdmVkLCB0aGUgY29udmVyc2lvbiBpcyByZS1ydW5cbiAgICAgICAgdmFsdWUgPSBkZWNvZGUoY29udmVydChzdHIyYXJyKHZhbHVlKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJykpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuaGVhZGVyc1trZXldID0gKHRoaXMuaGVhZGVyc1trZXldIHx8IFtdKS5jb25jYXQoW3RoaXMuX3BhcnNlSGVhZGVyVmFsdWUoa2V5LCB2YWx1ZSldKVxuXG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiBrZXkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuaGVhZGVyc1trZXldW3RoaXMuaGVhZGVyc1trZXldLmxlbmd0aCAtIDFdLnBhcmFtcy5jaGFyc2V0XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXNCaW5hcnkgJiYgdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgIC8vIHJlc2V0IHZhbHVlcyBhbmQgc3RhcnQgb3ZlciBvbmNlIGNoYXJzZXQgaGFzIGJlZW4gcmVzb2x2ZWQgYW5kIDhiaXQgY29udGVudCBoYXMgYmVlbiBmb3VuZFxuICAgICAgICBoYXNCaW5hcnkgPSBmYWxzZVxuICAgICAgICB0aGlzLmhlYWRlcnMgPSB7fVxuICAgICAgICBpID0gLTEgLy8gbmV4dCBpdGVyYXRpb24gaGFzIGkgPT0gMFxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZmV0Y2hDb250ZW50VHlwZSgpXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgc2luZ2xlIGhlYWRlciB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEhlYWRlciBrZXlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlIFZhbHVlIGZvciB0aGUga2V5XG4gICAqIEByZXR1cm4ge09iamVjdH0gcGFyc2VkIGhlYWRlclxuICAgKi9cbiAgX3BhcnNlSGVhZGVyVmFsdWUgKGtleSwgdmFsdWUpIHtcbiAgICBsZXQgcGFyc2VkVmFsdWVcbiAgICBsZXQgaXNBZGRyZXNzID0gZmFsc2VcblxuICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICBjYXNlICdjb250ZW50LXR5cGUnOlxuICAgICAgY2FzZSAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZyc6XG4gICAgICBjYXNlICdjb250ZW50LWRpc3Bvc2l0aW9uJzpcbiAgICAgIGNhc2UgJ2RraW0tc2lnbmF0dXJlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZnJvbSc6XG4gICAgICBjYXNlICdzZW5kZXInOlxuICAgICAgY2FzZSAndG8nOlxuICAgICAgY2FzZSAncmVwbHktdG8nOlxuICAgICAgY2FzZSAnY2MnOlxuICAgICAgY2FzZSAnYmNjJzpcbiAgICAgIGNhc2UgJ2FidXNlLXJlcG9ydHMtdG8nOlxuICAgICAgY2FzZSAnZXJyb3JzLXRvJzpcbiAgICAgIGNhc2UgJ3JldHVybi1wYXRoJzpcbiAgICAgIGNhc2UgJ2RlbGl2ZXJlZC10byc6XG4gICAgICAgIGlzQWRkcmVzcyA9IHRydWVcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IFtdLmNvbmNhdChwYXJzZUFkZHJlc3ModmFsdWUpIHx8IFtdKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHRoaXMuX3BhcnNlRGF0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgIH1cbiAgICB9XG4gICAgcGFyc2VkVmFsdWUuaW5pdGlhbCA9IHZhbHVlXG5cbiAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHBhcnNlZFZhbHVlLCB7IGlzQWRkcmVzcyB9KVxuXG4gICAgcmV0dXJuIHBhcnNlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZGF0ZSBzdHJpbmcgY2FuIGJlIHBhcnNlZC4gRmFsbHMgYmFjayByZXBsYWNpbmcgdGltZXpvbmVcbiAgICogYWJicmV2YXRpb25zIHdpdGggdGltZXpvbmUgdmFsdWVzLiBCb2d1cyB0aW1lem9uZXMgZGVmYXVsdCB0byBVVEMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgRGF0ZSBoZWFkZXJcbiAgICogQHJldHVybnMge1N0cmluZ30gVVRDIGRhdGUgc3RyaW5nIGlmIHBhcnNpbmcgc3VjY2VlZGVkLCBvdGhlcndpc2UgcmV0dXJucyBpbnB1dCB2YWx1ZVxuICAgKi9cbiAgX3BhcnNlRGF0ZSAoc3RyID0gJycpIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyLnRyaW0oKS5yZXBsYWNlKC9cXGJbYS16XSskL2ksIHR6ID0+IHRpbWV6b25lW3R6LnRvVXBwZXJDYXNlKCldIHx8ICcrMDAwMCcpKVxuICAgIHJldHVybiAoZGF0ZS50b1N0cmluZygpICE9PSAnSW52YWxpZCBEYXRlJykgPyBkYXRlLnRvVVRDU3RyaW5nKCkucmVwbGFjZSgvR01ULywgJyswMDAwJykgOiBzdHJcbiAgfVxuXG4gIF9kZWNvZGVIZWFkZXJDaGFyc2V0IChwYXJzZWQsIHsgaXNBZGRyZXNzIH0gPSB7fSkge1xuICAgIC8vIGRlY29kZSBkZWZhdWx0IHZhbHVlXG4gICAgaWYgKHR5cGVvZiBwYXJzZWQudmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBwYXJzZWQudmFsdWUgPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnZhbHVlKVxuICAgIH1cblxuICAgIC8vIGRlY29kZSBwb3NzaWJsZSBwYXJhbXNcbiAgICBPYmplY3Qua2V5cyhwYXJzZWQucGFyYW1zIHx8IHt9KS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBhcmFtc1trZXldID09PSAnc3RyaW5nJykge1xuICAgICAgICBwYXJzZWQucGFyYW1zW2tleV0gPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnBhcmFtc1trZXldKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBkZWNvZGUgYWRkcmVzc2VzXG4gICAgaWYgKGlzQWRkcmVzcyAmJiBBcnJheS5pc0FycmF5KHBhcnNlZC52YWx1ZSkpIHtcbiAgICAgIHBhcnNlZC52YWx1ZS5mb3JFYWNoKGFkZHIgPT4ge1xuICAgICAgICBpZiAoYWRkci5uYW1lKSB7XG4gICAgICAgICAgYWRkci5uYW1lID0gbWltZVdvcmRzRGVjb2RlKGFkZHIubmFtZSlcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhZGRyLmdyb3VwKSkge1xuICAgICAgICAgICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldCh7IHZhbHVlOiBhZGRyLmdyb3VwIH0sIHsgaXNBZGRyZXNzOiB0cnVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UeXBlIHZhbHVlIGFuZCBzZWxlY3RzIGZvbGxvd2luZyBhY3Rpb25zLlxuICAgKi9cbiAgZmV0Y2hDb250ZW50VHlwZSAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgndGV4dC9wbGFpbicpXG4gICAgdGhpcy5jb250ZW50VHlwZSA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXR5cGUnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFR5cGUudmFsdWUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnNoaWZ0KCkgfHwgJ3RleHQnKVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUucGFyYW1zICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldFxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPT09ICdtdWx0aXBhcnQnICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5KSB7XG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXVxuICAgICAgdGhpcy5faXNNdWx0aXBhcnQgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnBvcCgpIHx8ICdtaXhlZCcpXG4gICAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRm9yIGF0dGFjaG1lbnQgKGlubGluZS9yZWd1bGFyKSBpZiBjaGFyc2V0IGlzIG5vdCBkZWZpbmVkIGFuZCBhdHRhY2htZW50IGlzIG5vbi10ZXh0LyosXG4gICAgICogdGhlbiBkZWZhdWx0IGNoYXJzZXQgdG8gYmluYXJ5LlxuICAgICAqIFJlZmVyIHRvIGlzc3VlOiBodHRwczovL2dpdGh1Yi5jb20vZW1haWxqcy9lbWFpbGpzLW1pbWUtcGFyc2VyL2lzc3Vlcy8xOFxuICAgICAqL1xuICAgIGNvbnN0IGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gcGF0aE9yKGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLCAnMCddKSh0aGlzKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnYXR0YWNobWVudCdcbiAgICBjb25zdCBpc0lubGluZUF0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2lubGluZSdcbiAgICBpZiAoKGlzQXR0YWNobWVudCB8fCBpc0lubGluZUF0dGFjaG1lbnQpICYmIHRoaXMuY29udGVudFR5cGUudHlwZSAhPT0gJ3RleHQnICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9ICdiaW5hcnknXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudmFsdWUgPT09ICdtZXNzYWdlL3JmYzgyMicgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBQYXJzZSBtZXNzYWdlL3JmYzgyMiBvbmx5IGlmIHRoZSBtaW1lIHBhcnQgaXMgbm90IG1hcmtlZCB3aXRoIGNvbnRlbnQtZGlzcG9zaXRpb246IGF0dGFjaG1lbnQsXG4gICAgICAgKiBvdGhlcndpc2UgdHJlYXQgaXQgbGlrZSBhIHJlZ3VsYXIgYXR0YWNobWVudFxuICAgICAgICovXG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcy5ub2RlQ291bnRlcilcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFt0aGlzLl9jdXJyZW50Q2hpbGRdXG4gICAgICB0aGlzLl9pc1JmYzgyMiA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHJhbnNmZXItRW5jb2RpbmcgdmFsdWUgdG8gc2VlIGlmIHRoZSBib2R5IG5lZWRzIHRvIGJlIGNvbnZlcnRlZFxuICAgKiBiZWZvcmUgaXQgY2FuIGJlIGVtaXR0ZWRcbiAgICovXG4gIF9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJzdiaXQnKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZycsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9IHBhdGhPcignJywgWydjb250ZW50VHJhbnNmZXJFbmNvZGluZycsICd2YWx1ZSddKSh0aGlzKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEJPRFkgc3RhdGUuIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgcmZjODIyIG5vZGUsXG4gICAqIHBhc3NlcyBsaW5lIHZhbHVlIHRvIGNoaWxkIG5vZGVzLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICogQHBhcmFtIHtTdHJpbmd9IHRlcm1pbmF0b3IgVGhlIGxpbmUgdGVybWluYXRvciBkZXRlY3RlZCBieSBwYXJzZXJcbiAgICovXG4gIF9wcm9jZXNzQm9keUxpbmUgKGxpbmUsIHRlcm1pbmF0b3IpIHtcbiAgICBpZiAodGhpcy5faXNNdWx0aXBhcnQpIHtcbiAgICAgIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkpIHtcbiAgICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IGxpbmUgKyAnXFxuJ1xuICAgICAgICBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcy5ub2RlQ291bnRlcilcbiAgICAgICAgdGhpcy5jaGlsZE5vZGVzLnB1c2godGhpcy5fY3VycmVudENoaWxkKVxuICAgICAgfSBlbHNlIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS0nKSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2VcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC53cml0ZUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElnbm9yZSBtdWx0aXBhcnQgcHJlYW1ibGVcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUsIHRlcm1pbmF0b3IpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2xpbmVDb3VudCsrXG5cbiAgICAgIHN3aXRjaCAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSkge1xuICAgICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gbGluZSArIHRlcm1pbmF0b3JcbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlICdxdW90ZWQtcHJpbnRhYmxlJzoge1xuICAgICAgICAgIGxldCBjdXJMaW5lID0gdGhpcy5fbGluZVJlbWFpbmRlciArIGxpbmUgKyB0ZXJtaW5hdG9yXG4gICAgICAgICAgY29uc3QgbWF0Y2ggPSBjdXJMaW5lLm1hdGNoKC89W2EtZjAtOV17MCwxfSQvaSlcbiAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSBtYXRjaFswXVxuICAgICAgICAgICAgY3VyTGluZSA9IGN1ckxpbmUuc3Vic3RyKDAsIGN1ckxpbmUubGVuZ3RoIC0gdGhpcy5fbGluZVJlbWFpbmRlci5sZW5ndGgpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJ1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGN1ckxpbmVcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJzdiaXQnOlxuICAgICAgICBjYXNlICc4Yml0JzpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGxpbmUgKyB0ZXJtaW5hdG9yXG4gICAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjaHVuayBvZiB0aGUgYm9keVxuICAqL1xuICBfZW1pdEJvZHkgKCkge1xuICAgIHRoaXMuX2RlY29kZUJvZHlCdWZmZXIoKVxuICAgIGlmICh0aGlzLl9pc011bHRpcGFydCB8fCAhdGhpcy5fYm9keUJ1ZmZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJvY2Vzc0Zsb3dlZFRleHQoKVxuICAgIHRoaXMuY29udGVudCA9IHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICB0aGlzLl9wcm9jZXNzSHRtbFRleHQoKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJ1xuICB9XG5cbiAgX3Byb2Nlc3NGbG93ZWRUZXh0ICgpIHtcbiAgICBjb25zdCBpc1RleHQgPSAvXnRleHRcXC8ocGxhaW58aHRtbCkkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKVxuICAgIGNvbnN0IGlzRmxvd2VkID0gL15mbG93ZWQkL2kudGVzdChwYXRoT3IoJycsIFsnY29udGVudFR5cGUnLCAncGFyYW1zJywgJ2Zvcm1hdCddKSh0aGlzKSlcbiAgICBpZiAoIWlzVGV4dCB8fCAhaXNGbG93ZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVsU3AgPSAvXnllcyQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUucGFyYW1zLmRlbHNwKVxuICAgIGxldCBib2R5QnVmZmVyID0gJydcblxuICAgIGZvckVhY2hMaW5lKHRoaXMuX2JvZHlCdWZmZXIsIGZ1bmN0aW9uIChsaW5lLCB0ZXJtaW5hdG9yKSB7XG4gICAgICBjb25zdCBlbmRzV2l0aFNwYWNlID0gLyAkLy50ZXN0KGxpbmUpXG4gICAgICBjb25zdCBpc0JvdW5kYXJ5ID0gLyhefFxcbiktLSAkLy50ZXN0KGxpbmUpXG5cbiAgICAgIGJvZHlCdWZmZXIgKz0gKGRlbFNwID8gbGluZS5yZXBsYWNlKC9bIF0rJC8sICcnKSA6IGxpbmUpICsgKChlbmRzV2l0aFNwYWNlICYmICFpc0JvdW5kYXJ5KSA/ICcnIDogdGVybWluYXRvcilcbiAgICB9KVxuXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9IGJvZHlCdWZmZXIucmVwbGFjZSgvXiAvZ20sICcnKSAvLyByZW1vdmUgd2hpdGVzcGFjZSBzdHVmZmluZyBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNjc2I3NlY3Rpb24tNC40XG4gIH1cblxuICBfcHJvY2Vzc0h0bWxUZXh0ICgpIHtcbiAgICBjb25zdCBjb250ZW50RGlzcG9zaXRpb24gPSAodGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgdGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ11bMF0pIHx8IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgaXNIdG1sID0gL150ZXh0XFwvKHBsYWlufGh0bWwpJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSlcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAvXmF0dGFjaG1lbnQkL2kudGVzdChjb250ZW50RGlzcG9zaXRpb24udmFsdWUpXG4gICAgaWYgKGlzSHRtbCAmJiAhaXNBdHRhY2htZW50KSB7XG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiAvXnRleHRcXC9odG1sJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSkpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5kZXRlY3RIVE1MQ2hhcnNldCh0aGlzLl9ib2R5QnVmZmVyKVxuICAgICAgfVxuXG4gICAgICAvLyBkZWNvZGUgXCJiaW5hcnlcIiBzdHJpbmcgdG8gYW4gdW5pY29kZSBzdHJpbmdcbiAgICAgIGlmICghL151dGZbLV9dPzgkL2kudGVzdCh0aGlzLmNoYXJzZXQpKSB7XG4gICAgICAgIHRoaXMuY29udGVudCA9IGNvbnZlcnQoc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJylcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9PT0gJ2Jhc2U2NCcpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gdXRmOFN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gb3ZlcnJpZGUgY2hhcnNldCBmb3IgdGV4dCBub2Rlc1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldCA9ICd1dGYtOCdcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGV0ZWN0IGNoYXJzZXQgZnJvbSBhIGh0bWwgZmlsZVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaHRtbCBJbnB1dCBIVE1MXG4gICAqIEByZXR1cm5zIHtTdHJpbmd9IENoYXJzZXQgaWYgZm91bmQgb3IgdW5kZWZpbmVkXG4gICAqL1xuICBkZXRlY3RIVE1MQ2hhcnNldCAoaHRtbCkge1xuICAgIGxldCBjaGFyc2V0LCBpbnB1dFxuXG4gICAgaHRtbCA9IGh0bWwucmVwbGFjZSgvXFxyP1xcbnxcXHIvZywgJyAnKVxuICAgIGxldCBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMraHR0cC1lcXVpdj1bXCInXFxzXSpjb250ZW50LXR5cGVbXj5dKj8+L2kpXG4gICAgaWYgKG1ldGEpIHtcbiAgICAgIGlucHV0ID0gbWV0YVswXVxuICAgIH1cblxuICAgIGlmIChpbnB1dCkge1xuICAgICAgY2hhcnNldCA9IGlucHV0Lm1hdGNoKC9jaGFyc2V0XFxzPz1cXHM/KFthLXpBLVpcXC1fOjAtOV0qKTs/LylcbiAgICAgIGlmIChjaGFyc2V0KSB7XG4gICAgICAgIGNoYXJzZXQgPSAoY2hhcnNldFsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMrY2hhcnNldD1bXCInXFxzXSooW15cIic8Pi9cXHNdKykvaSlcbiAgICBpZiAoIWNoYXJzZXQgJiYgbWV0YSkge1xuICAgICAgY2hhcnNldCA9IChtZXRhWzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFyc2V0XG4gIH1cbn1cblxuY29uc3Qgc3RyMmFyciA9IHN0ciA9PiBuZXcgVWludDhBcnJheShzdHIuc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIuY2hhckNvZGVBdCgwKSkpXG5jb25zdCB1dGY4U3RyMmFyciA9IHN0ciA9PiBuZXcgVGV4dEVuY29kZXIoJ3V0Zi04JykuZW5jb2RlKHN0cilcbiJdfQ==
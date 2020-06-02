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
              var curLine = this._lineRemainder + line + terminator; // (this._lineCount > 1 ? '\n' : '') + line
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
            this._bodyBuffer += line + terminator; // (this._lineCount > 1 ? '\n' : '') + line
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taW1lcGFyc2VyLmpzIl0sIm5hbWVzIjpbInBhcnNlIiwiTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUyIsIk5vZGVDb3VudGVyIiwiY291bnQiLCJFcnJvciIsImZvckVhY2hMaW5lIiwic3RyIiwiY2FsbGJhY2siLCJsaW5lIiwidGVybWluYXRvciIsImkiLCJsZW5ndGgiLCJjaGFyIiwibmV4dENoYXIiLCJjaHVuayIsInJvb3QiLCJNaW1lTm9kZSIsIlN0cmluZyIsImZyb21DaGFyQ29kZSIsImFwcGx5Iiwid3JpdGVMaW5lIiwiZmluYWxpemUiLCJub2RlQ291bnRlciIsImJ1bXAiLCJoZWFkZXIiLCJoZWFkZXJzIiwiYm9keXN0cnVjdHVyZSIsImNoaWxkTm9kZXMiLCJyYXciLCJfc3RhdGUiLCJfYm9keUJ1ZmZlciIsIl9saW5lQ291bnQiLCJfY3VycmVudENoaWxkIiwiX2xpbmVSZW1haW5kZXIiLCJfaXNNdWx0aXBhcnQiLCJfbXVsdGlwYXJ0Qm91bmRhcnkiLCJfaXNSZmM4MjIiLCJfcHJvY2Vzc0hlYWRlckxpbmUiLCJfcHJvY2Vzc0JvZHlMaW5lIiwiX2VtaXRCb2R5IiwicmVkdWNlIiwiYWdnIiwiY2hpbGQiLCJqb2luIiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ2YWx1ZSIsImNoYXJzZXQiLCJyZXBsYWNlIiwibSIsImNvZGUiLCJwYXJzZUludCIsIl9wYXJzZUhlYWRlcnMiLCJtYXRjaCIsInB1c2giLCJoYXNCaW5hcnkiLCJsZW4iLCJzcGxpdCIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwic3RyMmFyciIsImNvbmNhdCIsIl9wYXJzZUhlYWRlclZhbHVlIiwicGFyYW1zIiwiZmV0Y2hDb250ZW50VHlwZSIsIl9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJwYXJzZWRWYWx1ZSIsImlzQWRkcmVzcyIsIl9wYXJzZURhdGUiLCJpbml0aWFsIiwiX2RlY29kZUhlYWRlckNoYXJzZXQiLCJkYXRlIiwiRGF0ZSIsInRpbWV6b25lIiwidHoiLCJ0b1VwcGVyQ2FzZSIsInRvU3RyaW5nIiwidG9VVENTdHJpbmciLCJwYXJzZWQiLCJPYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsIkFycmF5IiwiaXNBcnJheSIsImFkZHIiLCJuYW1lIiwiZ3JvdXAiLCJkZWZhdWx0VmFsdWUiLCJjb250ZW50VHlwZSIsInR5cGUiLCJib3VuZGFyeSIsInBvcCIsImRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSIsImNvbnRlbnREaXNwb3NpdGlvbiIsImlzQXR0YWNobWVudCIsImlzSW5saW5lQXR0YWNobWVudCIsImN1ckxpbmUiLCJzdWJzdHIiLCJfZGVjb2RlQm9keUJ1ZmZlciIsIl9wcm9jZXNzRmxvd2VkVGV4dCIsImNvbnRlbnQiLCJfcHJvY2Vzc0h0bWxUZXh0IiwiaXNUZXh0IiwidGVzdCIsImlzRmxvd2VkIiwiZGVsU3AiLCJkZWxzcCIsImJvZHlCdWZmZXIiLCJlbmRzV2l0aFNwYWNlIiwiaXNCb3VuZGFyeSIsImlzSHRtbCIsImRldGVjdEhUTUxDaGFyc2V0IiwidXRmOFN0cjJhcnIiLCJodG1sIiwiaW5wdXQiLCJtZXRhIiwiVWludDhBcnJheSIsIm1hcCIsImNoYXJDb2RlQXQiLCJUZXh0RW5jb2RlciIsImVuY29kZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O2tCQW9Ed0JBLEs7O0FBcER4Qjs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOzs7Ozs7OztBQUVBOzs7O0FBSUEsSUFBTUMsK0JBQStCLEdBQXJDOztJQUNhQyxXLFdBQUFBLFc7QUFDWCx5QkFBZTtBQUFBOztBQUNiLFNBQUtDLEtBQUwsR0FBYSxDQUFiO0FBQ0Q7Ozs7MkJBQ087QUFDTixVQUFJLEVBQUUsS0FBS0EsS0FBUCxHQUFlRiw0QkFBbkIsRUFBaUQ7QUFDL0MsY0FBTSxJQUFJRyxLQUFKLENBQVUsd0NBQVYsQ0FBTjtBQUNEO0FBQ0Y7Ozs7OztBQUdILFNBQVNDLFdBQVQsQ0FBc0JDLEdBQXRCLEVBQTJCQyxR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LE1BQXpCLENBQWdDbkgsR0FBaEMsQ0FBUDtBQUFBLENBQXBCIiwiZmlsZSI6Im1pbWVwYXJzZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBwYXRoT3IgfSBmcm9tICdyYW1kYSdcbmltcG9ydCB0aW1lem9uZSBmcm9tICcuL3RpbWV6b25lcydcbmltcG9ydCB7IGRlY29kZSwgYmFzZTY0RGVjb2RlLCBjb252ZXJ0LCBwYXJzZUhlYWRlclZhbHVlLCBtaW1lV29yZHNEZWNvZGUgfSBmcm9tICdlbWFpbGpzLW1pbWUtY29kZWMnXG5pbXBvcnQgeyBUZXh0RW5jb2RlciB9IGZyb20gJ3RleHQtZW5jb2RpbmcnXG5pbXBvcnQgcGFyc2VBZGRyZXNzIGZyb20gJ2VtYWlsanMtYWRkcmVzc3BhcnNlcidcblxuLypcbiAqIENvdW50cyBNSU1FIG5vZGVzIHRvIHByZXZlbnQgbWVtb3J5IGV4aGF1c3Rpb24gYXR0YWNrcyAoQ1dFLTQwMClcbiAqIHNlZTogaHR0cHM6Ly9zbnlrLmlvL3Z1bG4vbnBtOmVtYWlsanMtbWltZS1wYXJzZXI6MjAxODA2MjVcbiAqL1xuY29uc3QgTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUyA9IDk5OVxuZXhwb3J0IGNsYXNzIE5vZGVDb3VudGVyIHtcbiAgY29uc3RydWN0b3IgKCkge1xuICAgIHRoaXMuY291bnQgPSAwXG4gIH1cbiAgYnVtcCAoKSB7XG4gICAgaWYgKCsrdGhpcy5jb3VudCA+IE1BWElNVU1fTlVNQkVSX09GX01JTUVfTk9ERVMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSBudW1iZXIgb2YgTUlNRSBub2RlcyBleGNlZWRlZCEnKVxuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBmb3JFYWNoTGluZSAoc3RyLCBjYWxsYmFjaykge1xuICBsZXQgbGluZSA9ICcnXG4gIGxldCB0ZXJtaW5hdG9yID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpICs9IDEpIHtcbiAgICBjb25zdCBjaGFyID0gc3RyW2ldXG4gICAgaWYgKGNoYXIgPT09ICdcXHInIHx8IGNoYXIgPT09ICdcXG4nKSB7XG4gICAgICBjb25zdCBuZXh0Q2hhciA9IHN0cltpICsgMV1cbiAgICAgIHRlcm1pbmF0b3IgKz0gY2hhclxuICAgICAgLy8gRGV0ZWN0IFdpbmRvd3MgYW5kIE1hY2ludG9zaCBsaW5lIHRlcm1pbmF0b3JzLlxuICAgICAgaWYgKCh0ZXJtaW5hdG9yICsgbmV4dENoYXIpID09PSAnXFxyXFxuJyB8fCAodGVybWluYXRvciArIG5leHRDaGFyKSA9PT0gJ1xcblxccicpIHtcbiAgICAgICAgY2FsbGJhY2sobGluZSwgdGVybWluYXRvciArIG5leHRDaGFyKVxuICAgICAgICBsaW5lID0gJydcbiAgICAgICAgdGVybWluYXRvciA9ICcnXG4gICAgICAgIGkgKz0gMVxuICAgICAgLy8gRGV0ZWN0IHNpbmdsZS1jaGFyYWN0ZXIgdGVybWluYXRvcnMsIGxpa2UgTGludXggb3Igb3RoZXIgc3lzdGVtLlxuICAgICAgfSBlbHNlIGlmICh0ZXJtaW5hdG9yID09PSAnXFxuJyB8fCB0ZXJtaW5hdG9yID09PSAnXFxyJykge1xuICAgICAgICBjYWxsYmFjayhsaW5lLCB0ZXJtaW5hdG9yKVxuICAgICAgICBsaW5lID0gJydcbiAgICAgICAgdGVybWluYXRvciA9ICcnXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmUgKz0gY2hhclxuICAgIH1cbiAgfVxuICAvLyBGbHVzaCB0aGUgbGluZSBhbmQgdGVybWluYXRvciB2YWx1ZXMgaWYgbmVjZXNzYXJ5OyBoYW5kbGUgZWRnZSBjYXNlcyB3aGVyZSBNSU1FIGlzIGdlbmVyYXRlZCB3aXRob3V0IGxhc3QgbGluZSB0ZXJtaW5hdG9yLlxuICBpZiAobGluZSAhPT0gJycgfHwgdGVybWluYXRvciAhPT0gJycpIHtcbiAgICBjYWxsYmFjayhsaW5lLCB0ZXJtaW5hdG9yKVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHBhcnNlIChjaHVuaykge1xuICBjb25zdCByb290ID0gbmV3IE1pbWVOb2RlKG5ldyBOb2RlQ291bnRlcigpKVxuICBjb25zdCBzdHIgPSB0eXBlb2YgY2h1bmsgPT09ICdzdHJpbmcnID8gY2h1bmsgOiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGNodW5rKVxuICBmb3JFYWNoTGluZShzdHIsIGZ1bmN0aW9uIChsaW5lLCB0ZXJtaW5hdG9yKSB7XG4gICAgcm9vdC53cml0ZUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgfSlcbiAgcm9vdC5maW5hbGl6ZSgpXG4gIHJldHVybiByb290XG59XG5cbmV4cG9ydCBjbGFzcyBNaW1lTm9kZSB7XG4gIGNvbnN0cnVjdG9yIChub2RlQ291bnRlciA9IG5ldyBOb2RlQ291bnRlcigpKSB7XG4gICAgdGhpcy5ub2RlQ291bnRlciA9IG5vZGVDb3VudGVyXG4gICAgdGhpcy5ub2RlQ291bnRlci5idW1wKClcblxuICAgIHRoaXMuaGVhZGVyID0gW10gLy8gQW4gYXJyYXkgb2YgdW5mb2xkZWQgaGVhZGVyIGxpbmVzXG4gICAgdGhpcy5oZWFkZXJzID0ge30gLy8gQW4gb2JqZWN0IHRoYXQgaG9sZHMgaGVhZGVyIGtleT12YWx1ZSBwYWlyc1xuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9ICcnXG4gICAgdGhpcy5jaGlsZE5vZGVzID0gW10gLy8gSWYgdGhpcyBpcyBhIG11bHRpcGFydCBvciBtZXNzYWdlL3JmYzgyMiBtaW1lIHBhcnQsIHRoZSB2YWx1ZSB3aWxsIGJlIGNvbnZlcnRlZCB0byBhcnJheSBhbmQgaG9sZCBhbGwgY2hpbGQgbm9kZXMgZm9yIHRoaXMgbm9kZVxuICAgIHRoaXMucmF3ID0gJycgLy8gU3RvcmVzIHRoZSByYXcgY29udGVudCBvZiB0aGlzIG5vZGVcblxuICAgIHRoaXMuX3N0YXRlID0gJ0hFQURFUicgLy8gQ3VycmVudCBzdGF0ZSwgYWx3YXlzIHN0YXJ0cyBvdXQgd2l0aCBIRUFERVJcbiAgICB0aGlzLl9ib2R5QnVmZmVyID0gJycgLy8gQm9keSBidWZmZXJcbiAgICB0aGlzLl9saW5lQ291bnQgPSAwIC8vIExpbmUgY291bnRlciBib3IgdGhlIGJvZHkgcGFydFxuICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlIC8vIEFjdGl2ZSBjaGlsZCBub2RlIChpZiBhdmFpbGFibGUpXG4gICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnIC8vIFJlbWFpbmRlciBzdHJpbmcgd2hlbiBkZWFsaW5nIHdpdGggYmFzZTY0IGFuZCBxcCB2YWx1ZXNcbiAgICB0aGlzLl9pc011bHRpcGFydCA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IGZhbHNlIC8vIFN0b3JlcyBib3VuZGFyeSB2YWx1ZSBmb3IgY3VycmVudCBtdWx0aXBhcnQgbm9kZVxuICAgIHRoaXMuX2lzUmZjODIyID0gZmFsc2UgLy8gSW5kaWNhdGVzIGlmIHRoaXMgaXMgYSBtZXNzYWdlL3JmYzgyMiBub2RlXG4gIH1cblxuICB3cml0ZUxpbmUgKGxpbmUsIHRlcm1pbmF0b3IpIHtcbiAgICB0aGlzLnJhdyArPSBsaW5lICsgKHRlcm1pbmF0b3IgfHwgJ1xcbicpXG5cbiAgICBpZiAodGhpcy5fc3RhdGUgPT09ICdIRUFERVInKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzSGVhZGVyTGluZShsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5fc3RhdGUgPT09ICdCT0RZJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0JvZHlMaW5lKGxpbmUsIHRlcm1pbmF0b3IpXG4gICAgfVxuICB9XG5cbiAgZmluYWxpemUgKCkge1xuICAgIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZW1pdEJvZHkoKVxuICAgIH1cblxuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9IHRoaXMuY2hpbGROb2Rlc1xuICAgICAgLnJlZHVjZSgoYWdnLCBjaGlsZCkgPT4gYWdnICsgJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJ1xcbicgKyBjaGlsZC5ib2R5c3RydWN0dXJlLCB0aGlzLmhlYWRlci5qb2luKCdcXG4nKSArICdcXG5cXG4nKSArXG4gICAgICAodGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS1cXG4nIDogJycpXG4gIH1cblxuICBfZGVjb2RlQm9keUJ1ZmZlciAoKSB7XG4gICAgc3dpdGNoICh0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlKSB7XG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICB0aGlzLl9ib2R5QnVmZmVyID0gYmFzZTY0RGVjb2RlKHRoaXMuX2JvZHlCdWZmZXIsIHRoaXMuY2hhcnNldClcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ3F1b3RlZC1wcmludGFibGUnOiB7XG4gICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgPSB0aGlzLl9ib2R5QnVmZmVyXG4gICAgICAgICAgLnJlcGxhY2UoLz0oXFxyP1xcbnwkKS9nLCAnJylcbiAgICAgICAgICAucmVwbGFjZSgvPShbYS1mMC05XXsyfSkvaWcsIChtLCBjb2RlKSA9PiBTdHJpbmcuZnJvbUNoYXJDb2RlKHBhcnNlSW50KGNvZGUsIDE2KSkpXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEhFQURFUiBzdGF0ZS4gSXQgdGhlIGxpbmUgaXMgZW1wdHksIGNoYW5nZSBzdGF0ZSB0byBCT0RZXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBsaW5lIEVudGlyZSBpbnB1dCBsaW5lIGFzICdiaW5hcnknIHN0cmluZ1xuICAgKi9cbiAgX3Byb2Nlc3NIZWFkZXJMaW5lIChsaW5lKSB7XG4gICAgaWYgKCFsaW5lKSB7XG4gICAgICB0aGlzLl9wYXJzZUhlYWRlcnMoKVxuICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbidcbiAgICAgIHRoaXMuX3N0YXRlID0gJ0JPRFknXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobGluZS5tYXRjaCgvXlxccy8pICYmIHRoaXMuaGVhZGVyLmxlbmd0aCkge1xuICAgICAgdGhpcy5oZWFkZXJbdGhpcy5oZWFkZXIubGVuZ3RoIC0gMV0gKz0gJ1xcbicgKyBsaW5lXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuaGVhZGVyLnB1c2gobGluZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSm9pbnMgZm9sZGVkIGhlYWRlciBsaW5lcyBhbmQgY2FsbHMgQ29udGVudC1UeXBlIGFuZCBUcmFuc2Zlci1FbmNvZGluZyBwcm9jZXNzb3JzXG4gICAqL1xuICBfcGFyc2VIZWFkZXJzICgpIHtcbiAgICBmb3IgKGxldCBoYXNCaW5hcnkgPSBmYWxzZSwgaSA9IDAsIGxlbiA9IHRoaXMuaGVhZGVyLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBsZXQgdmFsdWUgPSB0aGlzLmhlYWRlcltpXS5zcGxpdCgnOicpXG4gICAgICBjb25zdCBrZXkgPSAodmFsdWUuc2hpZnQoKSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIHZhbHVlID0gKHZhbHVlLmpvaW4oJzonKSB8fCAnJykucmVwbGFjZSgvXFxuL2csICcnKS50cmltKClcblxuICAgICAgaWYgKHZhbHVlLm1hdGNoKC9bXFx1MDA4MC1cXHVGRkZGXS8pKSB7XG4gICAgICAgIGlmICghdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgICAgaGFzQmluYXJ5ID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIC8vIHVzZSBkZWZhdWx0IGNoYXJzZXQgYXQgZmlyc3QgYW5kIGlmIHRoZSBhY3R1YWwgY2hhcnNldCBpcyByZXNvbHZlZCwgdGhlIGNvbnZlcnNpb24gaXMgcmUtcnVuXG4gICAgICAgIHZhbHVlID0gZGVjb2RlKGNvbnZlcnQoc3RyMmFycih2YWx1ZSksIHRoaXMuY2hhcnNldCB8fCAnaXNvLTg4NTktMScpKVxuICAgICAgfVxuXG4gICAgICB0aGlzLmhlYWRlcnNba2V5XSA9ICh0aGlzLmhlYWRlcnNba2V5XSB8fCBbXSkuY29uY2F0KFt0aGlzLl9wYXJzZUhlYWRlclZhbHVlKGtleSwgdmFsdWUpXSlcblxuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYga2V5ID09PSAnY29udGVudC10eXBlJykge1xuICAgICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmhlYWRlcnNba2V5XVt0aGlzLmhlYWRlcnNba2V5XS5sZW5ndGggLSAxXS5wYXJhbXMuY2hhcnNldFxuICAgICAgfVxuXG4gICAgICBpZiAoaGFzQmluYXJ5ICYmIHRoaXMuY2hhcnNldCkge1xuICAgICAgICAvLyByZXNldCB2YWx1ZXMgYW5kIHN0YXJ0IG92ZXIgb25jZSBjaGFyc2V0IGhhcyBiZWVuIHJlc29sdmVkIGFuZCA4Yml0IGNvbnRlbnQgaGFzIGJlZW4gZm91bmRcbiAgICAgICAgaGFzQmluYXJ5ID0gZmFsc2VcbiAgICAgICAgdGhpcy5oZWFkZXJzID0ge31cbiAgICAgICAgaSA9IC0xIC8vIG5leHQgaXRlcmF0aW9uIGhhcyBpID09IDBcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmZldGNoQ29udGVudFR5cGUoKVxuICAgIHRoaXMuX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZygpXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIHNpbmdsZSBoZWFkZXIgdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IGtleSBIZWFkZXIga2V5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSB2YWx1ZSBWYWx1ZSBmb3IgdGhlIGtleVxuICAgKiBAcmV0dXJuIHtPYmplY3R9IHBhcnNlZCBoZWFkZXJcbiAgICovXG4gIF9wYXJzZUhlYWRlclZhbHVlIChrZXksIHZhbHVlKSB7XG4gICAgbGV0IHBhcnNlZFZhbHVlXG4gICAgbGV0IGlzQWRkcmVzcyA9IGZhbHNlXG5cbiAgICBzd2l0Y2ggKGtleSkge1xuICAgICAgY2FzZSAnY29udGVudC10eXBlJzpcbiAgICAgIGNhc2UgJ2NvbnRlbnQtdHJhbnNmZXItZW5jb2RpbmcnOlxuICAgICAgY2FzZSAnY29udGVudC1kaXNwb3NpdGlvbic6XG4gICAgICBjYXNlICdka2ltLXNpZ25hdHVyZSc6XG4gICAgICAgIHBhcnNlZFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSh2YWx1ZSlcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2Zyb20nOlxuICAgICAgY2FzZSAnc2VuZGVyJzpcbiAgICAgIGNhc2UgJ3RvJzpcbiAgICAgIGNhc2UgJ3JlcGx5LXRvJzpcbiAgICAgIGNhc2UgJ2NjJzpcbiAgICAgIGNhc2UgJ2JjYyc6XG4gICAgICBjYXNlICdhYnVzZS1yZXBvcnRzLXRvJzpcbiAgICAgIGNhc2UgJ2Vycm9ycy10byc6XG4gICAgICBjYXNlICdyZXR1cm4tcGF0aCc6XG4gICAgICBjYXNlICdkZWxpdmVyZWQtdG8nOlxuICAgICAgICBpc0FkZHJlc3MgPSB0cnVlXG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiBbXS5jb25jYXQocGFyc2VBZGRyZXNzKHZhbHVlKSB8fCBbXSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiB0aGlzLl9wYXJzZURhdGUodmFsdWUpXG4gICAgICAgIH1cbiAgICAgICAgYnJlYWtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiB2YWx1ZVxuICAgICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFZhbHVlLmluaXRpYWwgPSB2YWx1ZVxuXG4gICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldChwYXJzZWRWYWx1ZSwgeyBpc0FkZHJlc3MgfSlcblxuICAgIHJldHVybiBwYXJzZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIGRhdGUgc3RyaW5nIGNhbiBiZSBwYXJzZWQuIEZhbGxzIGJhY2sgcmVwbGFjaW5nIHRpbWV6b25lXG4gICAqIGFiYnJldmF0aW9ucyB3aXRoIHRpbWV6b25lIHZhbHVlcy4gQm9ndXMgdGltZXpvbmVzIGRlZmF1bHQgdG8gVVRDLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gc3RyIERhdGUgaGVhZGVyXG4gICAqIEByZXR1cm5zIHtTdHJpbmd9IFVUQyBkYXRlIHN0cmluZyBpZiBwYXJzaW5nIHN1Y2NlZWRlZCwgb3RoZXJ3aXNlIHJldHVybnMgaW5wdXQgdmFsdWVcbiAgICovXG4gIF9wYXJzZURhdGUgKHN0ciA9ICcnKSB7XG4gICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHN0ci50cmltKCkucmVwbGFjZSgvXFxiW2Etel0rJC9pLCB0eiA9PiB0aW1lem9uZVt0ei50b1VwcGVyQ2FzZSgpXSB8fCAnKzAwMDAnKSlcbiAgICByZXR1cm4gKGRhdGUudG9TdHJpbmcoKSAhPT0gJ0ludmFsaWQgRGF0ZScpID8gZGF0ZS50b1VUQ1N0cmluZygpLnJlcGxhY2UoL0dNVC8sICcrMDAwMCcpIDogc3RyXG4gIH1cblxuICBfZGVjb2RlSGVhZGVyQ2hhcnNldCAocGFyc2VkLCB7IGlzQWRkcmVzcyB9ID0ge30pIHtcbiAgICAvLyBkZWNvZGUgZGVmYXVsdCB2YWx1ZVxuICAgIGlmICh0eXBlb2YgcGFyc2VkLnZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcGFyc2VkLnZhbHVlID0gbWltZVdvcmRzRGVjb2RlKHBhcnNlZC52YWx1ZSlcbiAgICB9XG5cbiAgICAvLyBkZWNvZGUgcG9zc2libGUgcGFyYW1zXG4gICAgT2JqZWN0LmtleXMocGFyc2VkLnBhcmFtcyB8fCB7fSkuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICBpZiAodHlwZW9mIHBhcnNlZC5wYXJhbXNba2V5XSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcGFyc2VkLnBhcmFtc1trZXldID0gbWltZVdvcmRzRGVjb2RlKHBhcnNlZC5wYXJhbXNba2V5XSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gZGVjb2RlIGFkZHJlc3Nlc1xuICAgIGlmIChpc0FkZHJlc3MgJiYgQXJyYXkuaXNBcnJheShwYXJzZWQudmFsdWUpKSB7XG4gICAgICBwYXJzZWQudmFsdWUuZm9yRWFjaChhZGRyID0+IHtcbiAgICAgICAgaWYgKGFkZHIubmFtZSkge1xuICAgICAgICAgIGFkZHIubmFtZSA9IG1pbWVXb3Jkc0RlY29kZShhZGRyLm5hbWUpXG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYWRkci5ncm91cCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2RlY29kZUhlYWRlckNoYXJzZXQoeyB2YWx1ZTogYWRkci5ncm91cCB9LCB7IGlzQWRkcmVzczogdHJ1ZSB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyc2VkXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHlwZSB2YWx1ZSBhbmQgc2VsZWN0cyBmb2xsb3dpbmcgYWN0aW9ucy5cbiAgICovXG4gIGZldGNoQ29udGVudFR5cGUgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJ3RleHQvcGxhaW4nKVxuICAgIHRoaXMuY29udGVudFR5cGUgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10eXBlJywgJzAnXSkodGhpcylcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnZhbHVlID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpXG4gICAgdGhpcy5jb250ZW50VHlwZS50eXBlID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUuc3BsaXQoJy8nKS5zaGlmdCgpIHx8ICd0ZXh0JylcblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcyAmJiB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXRcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS50eXBlID09PSAnbXVsdGlwYXJ0JyAmJiB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5ib3VuZGFyeSkge1xuICAgICAgdGhpcy5jaGlsZE5vZGVzID0gW11cbiAgICAgIHRoaXMuX2lzTXVsdGlwYXJ0ID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUuc3BsaXQoJy8nKS5wb3AoKSB8fCAnbWl4ZWQnKVxuICAgICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5ib3VuZGFyeVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZvciBhdHRhY2htZW50IChpbmxpbmUvcmVndWxhcikgaWYgY2hhcnNldCBpcyBub3QgZGVmaW5lZCBhbmQgYXR0YWNobWVudCBpcyBub24tdGV4dC8qLFxuICAgICAqIHRoZW4gZGVmYXVsdCBjaGFyc2V0IHRvIGJpbmFyeS5cbiAgICAgKiBSZWZlciB0byBpc3N1ZTogaHR0cHM6Ly9naXRodWIuY29tL2VtYWlsanMvZW1haWxqcy1taW1lLXBhcnNlci9pc3N1ZXMvMThcbiAgICAgKi9cbiAgICBjb25zdCBkZWZhdWx0Q29udGVudERpc3Bvc2l0aW9uVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGNvbnRlbnREaXNwb3NpdGlvbiA9IHBhdGhPcihkZWZhdWx0Q29udGVudERpc3Bvc2l0aW9uVmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LWRpc3Bvc2l0aW9uJywgJzAnXSkodGhpcylcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2F0dGFjaG1lbnQnXG4gICAgY29uc3QgaXNJbmxpbmVBdHRhY2htZW50ID0gKGNvbnRlbnREaXNwb3NpdGlvbi52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKCkgPT09ICdpbmxpbmUnXG4gICAgaWYgKChpc0F0dGFjaG1lbnQgfHwgaXNJbmxpbmVBdHRhY2htZW50KSAmJiB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgIT09ICd0ZXh0JyAmJiAhdGhpcy5jaGFyc2V0KSB7XG4gICAgICB0aGlzLmNoYXJzZXQgPSAnYmluYXJ5J1xuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlID09PSAnbWVzc2FnZS9yZmM4MjInICYmICFpc0F0dGFjaG1lbnQpIHtcbiAgICAgIC8qKlxuICAgICAgICogUGFyc2UgbWVzc2FnZS9yZmM4MjIgb25seSBpZiB0aGUgbWltZSBwYXJ0IGlzIG5vdCBtYXJrZWQgd2l0aCBjb250ZW50LWRpc3Bvc2l0aW9uOiBhdHRhY2htZW50LFxuICAgICAgICogb3RoZXJ3aXNlIHRyZWF0IGl0IGxpa2UgYSByZWd1bGFyIGF0dGFjaG1lbnRcbiAgICAgICAqL1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMubm9kZUNvdW50ZXIpXG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbdGhpcy5fY3VycmVudENoaWxkXVxuICAgICAgdGhpcy5faXNSZmM4MjIgPSB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nIHZhbHVlIHRvIHNlZSBpZiB0aGUgYm9keSBuZWVkcyB0byBiZSBjb252ZXJ0ZWRcbiAgICogYmVmb3JlIGl0IGNhbiBiZSBlbWl0dGVkXG4gICAqL1xuICBfcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nICgpIHtcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCc3Yml0JylcbiAgICB0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nID0gcGF0aE9yKGRlZmF1bHRWYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtdHJhbnNmZXItZW5jb2RpbmcnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUgPSBwYXRoT3IoJycsIFsnY29udGVudFRyYW5zZmVyRW5jb2RpbmcnLCAndmFsdWUnXSkodGhpcykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgYSBsaW5lIGluIHRoZSBCT0RZIHN0YXRlLiBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIHJmYzgyMiBub2RlLFxuICAgKiBwYXNzZXMgbGluZSB2YWx1ZSB0byBjaGlsZCBub2Rlcy5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqIEBwYXJhbSB7U3RyaW5nfSB0ZXJtaW5hdG9yIFRoZSBsaW5lIHRlcm1pbmF0b3IgZGV0ZWN0ZWQgYnkgcGFyc2VyXG4gICAqL1xuICBfcHJvY2Vzc0JvZHlMaW5lIChsaW5lLCB0ZXJtaW5hdG9yKSB7XG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0KSB7XG4gICAgICBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5KSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMubm9kZUNvdW50ZXIpXG4gICAgICAgIHRoaXMuY2hpbGROb2Rlcy5wdXNoKHRoaXMuX2N1cnJlbnRDaGlsZClcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJy0tJykge1xuICAgICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gbGluZSArICdcXG4nXG4gICAgICAgIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUsIHRlcm1pbmF0b3IpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZ25vcmUgbXVsdGlwYXJ0IHByZWFtYmxlXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLndyaXRlTGluZShsaW5lLCB0ZXJtaW5hdG9yKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9saW5lQ291bnQrK1xuXG4gICAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGxpbmUgKyB0ZXJtaW5hdG9yXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6IHtcbiAgICAgICAgICBsZXQgY3VyTGluZSA9IHRoaXMuX2xpbmVSZW1haW5kZXIgKyBsaW5lICsgdGVybWluYXRvciAvLyAodGhpcy5fbGluZUNvdW50ID4gMSA/ICdcXG4nIDogJycpICsgbGluZVxuICAgICAgICAgIGNvbnN0IG1hdGNoID0gY3VyTGluZS5tYXRjaCgvPVthLWYwLTldezAsMX0kL2kpXG4gICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gbWF0Y2hbMF1cbiAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJydcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciArPSBjdXJMaW5lXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgICBjYXNlICc3Yml0JzpcbiAgICAgICAgY2FzZSAnOGJpdCc6XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciArPSBsaW5lICsgdGVybWluYXRvciAvLyAodGhpcy5fbGluZUNvdW50ID4gMSA/ICdcXG4nIDogJycpICsgbGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGEgY2h1bmsgb2YgdGhlIGJvZHlcbiAgKi9cbiAgX2VtaXRCb2R5ICgpIHtcbiAgICB0aGlzLl9kZWNvZGVCb2R5QnVmZmVyKClcbiAgICBpZiAodGhpcy5faXNNdWx0aXBhcnQgfHwgIXRoaXMuX2JvZHlCdWZmZXIpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3Byb2Nlc3NGbG93ZWRUZXh0KClcbiAgICB0aGlzLmNvbnRlbnQgPSBzdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgdGhpcy5fcHJvY2Vzc0h0bWxUZXh0KClcbiAgICB0aGlzLl9ib2R5QnVmZmVyID0gJydcbiAgfVxuXG4gIF9wcm9jZXNzRmxvd2VkVGV4dCAoKSB7XG4gICAgY29uc3QgaXNUZXh0ID0gL150ZXh0XFwvKHBsYWlufGh0bWwpJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSlcbiAgICBjb25zdCBpc0Zsb3dlZCA9IC9eZmxvd2VkJC9pLnRlc3QocGF0aE9yKCcnLCBbJ2NvbnRlbnRUeXBlJywgJ3BhcmFtcycsICdmb3JtYXQnXSkodGhpcykpXG4gICAgaWYgKCFpc1RleHQgfHwgIWlzRmxvd2VkKSByZXR1cm5cblxuICAgIGNvbnN0IGRlbFNwID0gL155ZXMkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5kZWxzcClcbiAgICBsZXQgYm9keUJ1ZmZlciA9ICcnXG5cbiAgICBmb3JFYWNoTGluZSh0aGlzLl9ib2R5QnVmZmVyLCBmdW5jdGlvbiAobGluZSwgdGVybWluYXRvcikge1xuICAgICAgY29uc3QgZW5kc1dpdGhTcGFjZSA9IC8gJC8udGVzdChsaW5lKVxuICAgICAgY29uc3QgaXNCb3VuZGFyeSA9IC8oXnxcXG4pLS0gJC8udGVzdChsaW5lKVxuXG4gICAgICBib2R5QnVmZmVyICs9IChkZWxTcCA/IGxpbmUucmVwbGFjZSgvWyBdKyQvLCAnJykgOiBsaW5lKSArICgoZW5kc1dpdGhTcGFjZSAmJiAhaXNCb3VuZGFyeSkgPyAnJyA6IHRlcm1pbmF0b3IpXG4gICAgfSlcblxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSBib2R5QnVmZmVyLnJlcGxhY2UoL14gL2dtLCAnJykgLy8gcmVtb3ZlIHdoaXRlc3BhY2Ugc3R1ZmZpbmcgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzY3NiNzZWN0aW9uLTQuNFxuICB9XG5cbiAgX3Byb2Nlc3NIdG1sVGV4dCAoKSB7XG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gKHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddICYmIHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddWzBdKSB8fCBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGlzSHRtbCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNBdHRhY2htZW50ID0gL15hdHRhY2htZW50JC9pLnRlc3QoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlKVxuICAgIGlmIChpc0h0bWwgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYgL150ZXh0XFwvaHRtbCQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuZGV0ZWN0SFRNTENoYXJzZXQodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gZGVjb2RlIFwiYmluYXJ5XCIgc3RyaW5nIHRvIGFuIHVuaWNvZGUgc3RyaW5nXG4gICAgICBpZiAoIS9edXRmWy1fXT84JC9pLnRlc3QodGhpcy5jaGFyc2V0KSkge1xuICAgICAgICB0aGlzLmNvbnRlbnQgPSBjb252ZXJ0KHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlciksIHRoaXMuY2hhcnNldCB8fCAnaXNvLTg4NTktMScpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUgPT09ICdiYXNlNjQnKSB7XG4gICAgICAgIHRoaXMuY29udGVudCA9IHV0ZjhTdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgICB9XG5cbiAgICAgIC8vIG92ZXJyaWRlIGNoYXJzZXQgZm9yIHRleHQgbm9kZXNcbiAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgPSAndXRmLTgnXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERldGVjdCBjaGFyc2V0IGZyb20gYSBodG1sIGZpbGVcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGh0bWwgSW5wdXQgSFRNTFxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBDaGFyc2V0IGlmIGZvdW5kIG9yIHVuZGVmaW5lZFxuICAgKi9cbiAgZGV0ZWN0SFRNTENoYXJzZXQgKGh0bWwpIHtcbiAgICBsZXQgY2hhcnNldCwgaW5wdXRcblxuICAgIGh0bWwgPSBodG1sLnJlcGxhY2UoL1xccj9cXG58XFxyL2csICcgJylcbiAgICBsZXQgbWV0YSA9IGh0bWwubWF0Y2goLzxtZXRhXFxzK2h0dHAtZXF1aXY9W1wiJ1xcc10qY29udGVudC10eXBlW14+XSo/Pi9pKVxuICAgIGlmIChtZXRhKSB7XG4gICAgICBpbnB1dCA9IG1ldGFbMF1cbiAgICB9XG5cbiAgICBpZiAoaW5wdXQpIHtcbiAgICAgIGNoYXJzZXQgPSBpbnB1dC5tYXRjaCgvY2hhcnNldFxccz89XFxzPyhbYS16QS1aXFwtXzowLTldKik7Py8pXG4gICAgICBpZiAoY2hhcnNldCkge1xuICAgICAgICBjaGFyc2V0ID0gKGNoYXJzZXRbMV0gfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgbWV0YSA9IGh0bWwubWF0Y2goLzxtZXRhXFxzK2NoYXJzZXQ9W1wiJ1xcc10qKFteXCInPD4vXFxzXSspL2kpXG4gICAgaWYgKCFjaGFyc2V0ICYmIG1ldGEpIHtcbiAgICAgIGNoYXJzZXQgPSAobWV0YVsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhcnNldFxuICB9XG59XG5cbmNvbnN0IHN0cjJhcnIgPSBzdHIgPT4gbmV3IFVpbnQ4QXJyYXkoc3RyLnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyLmNoYXJDb2RlQXQoMCkpKVxuY29uc3QgdXRmOFN0cjJhcnIgPSBzdHIgPT4gbmV3IFRleHRFbmNvZGVyKCd1dGYtOCcpLmVuY29kZShzdHIpXG4iXX0=
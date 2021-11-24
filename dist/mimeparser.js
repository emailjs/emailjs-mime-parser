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
        // remove soft linebreaks after space symbols.
        // delsp adds spaces to text to be able to fold it.
        // these spaces can be removed once the text is unfolded
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taW1lcGFyc2VyLmpzIl0sIm5hbWVzIjpbInBhcnNlIiwiTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUyIsIk5vZGVDb3VudGVyIiwiY291bnQiLCJFcnJvciIsImZvckVhY2hMaW5lIiwic3RyIiwiY2FsbGJhY2siLCJsaW5lIiwidGVybWluYXRvciIsImkiLCJsZW5ndGgiLCJjaGFyIiwibmV4dENoYXIiLCJjaHVuayIsInJvb3QiLCJNaW1lTm9kZSIsIlN0cmluZyIsImZyb21DaGFyQ29kZSIsImFwcGx5Iiwid3JpdGVMaW5lIiwiZmluYWxpemUiLCJub2RlQ291bnRlciIsImJ1bXAiLCJoZWFkZXIiLCJoZWFkZXJzIiwiYm9keXN0cnVjdHVyZSIsImNoaWxkTm9kZXMiLCJyYXciLCJfc3RhdGUiLCJfYm9keUJ1ZmZlciIsIl9saW5lQ291bnQiLCJfY3VycmVudENoaWxkIiwiX2xpbmVSZW1haW5kZXIiLCJfaXNNdWx0aXBhcnQiLCJfbXVsdGlwYXJ0Qm91bmRhcnkiLCJfaXNSZmM4MjIiLCJfcHJvY2Vzc0hlYWRlckxpbmUiLCJfcHJvY2Vzc0JvZHlMaW5lIiwiX2VtaXRCb2R5IiwicmVkdWNlIiwiYWdnIiwiY2hpbGQiLCJqb2luIiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ2YWx1ZSIsImNoYXJzZXQiLCJyZXBsYWNlIiwibSIsImNvZGUiLCJwYXJzZUludCIsIl9wYXJzZUhlYWRlcnMiLCJtYXRjaCIsInB1c2giLCJoYXNCaW5hcnkiLCJsZW4iLCJzcGxpdCIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwic3RyMmFyciIsImNvbmNhdCIsIl9wYXJzZUhlYWRlclZhbHVlIiwicGFyYW1zIiwiZmV0Y2hDb250ZW50VHlwZSIsIl9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJwYXJzZWRWYWx1ZSIsImlzQWRkcmVzcyIsIl9wYXJzZURhdGUiLCJpbml0aWFsIiwiX2RlY29kZUhlYWRlckNoYXJzZXQiLCJkYXRlIiwiRGF0ZSIsInRpbWV6b25lIiwidHoiLCJ0b1VwcGVyQ2FzZSIsInRvU3RyaW5nIiwidG9VVENTdHJpbmciLCJwYXJzZWQiLCJPYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsIkFycmF5IiwiaXNBcnJheSIsImFkZHIiLCJuYW1lIiwiZ3JvdXAiLCJkZWZhdWx0VmFsdWUiLCJjb250ZW50VHlwZSIsInR5cGUiLCJib3VuZGFyeSIsInBvcCIsImRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSIsImNvbnRlbnREaXNwb3NpdGlvbiIsImlzQXR0YWNobWVudCIsImlzSW5saW5lQXR0YWNobWVudCIsImN1ckxpbmUiLCJzdWJzdHIiLCJfZGVjb2RlQm9keUJ1ZmZlciIsIl9wcm9jZXNzRmxvd2VkVGV4dCIsImNvbnRlbnQiLCJfcHJvY2Vzc0h0bWxUZXh0IiwiaXNUZXh0IiwidGVzdCIsImlzRmxvd2VkIiwiZGVsU3AiLCJkZWxzcCIsImJvZHlCdWZmZXIiLCJlbmRzV2l0aFNwYWNlIiwiaXNCb3VuZGFyeSIsImlzSHRtbCIsImRldGVjdEhUTUxDaGFyc2V0IiwidXRmOFN0cjJhcnIiLCJodG1sIiwiaW5wdXQiLCJtZXRhIiwiVWludDhBcnJheSIsIm1hcCIsImNoYXJDb2RlQXQiLCJUZXh0RW5jb2RlciIsImVuY29kZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7O2tCQW9Ed0JBLEs7O0FBcER4Qjs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOzs7Ozs7OztBQUVBOzs7O0FBSUEsSUFBTUMsK0JBQStCLEdBQXJDOztJQUNhQyxXLFdBQUFBLFc7QUFDWCx5QkFBZTtBQUFBOztBQUNiLFNBQUtDLEtBQUwsR0FBYSxDQUFiO0FBQ0Q7Ozs7MkJBQ087QUFDTixVQUFJLEVBQUUsS0FBS0EsS0FBUCxHQUFlRiw0QkFBbkIsRUFBaUQ7QUFDL0MsY0FBTSxJQUFJRyxLQUFKLENBQVUsd0NBQVYsQ0FBTjtBQUNEO0FBQ0Y7Ozs7OztBQUdILFNBQVNDLFdBQVQsQ0FBc0JDLEdBQXRCLEVBQTJCQyxR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QUFnQ25ILEdBQWhDLENBQVA7QUFBQSxDQUFwQiIsImZpbGUiOiJtaW1lcGFyc2VyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcGF0aE9yIH0gZnJvbSAncmFtZGEnXG5pbXBvcnQgdGltZXpvbmUgZnJvbSAnLi90aW1lem9uZXMnXG5pbXBvcnQgeyBkZWNvZGUsIGJhc2U2NERlY29kZSwgY29udmVydCwgcGFyc2VIZWFkZXJWYWx1ZSwgbWltZVdvcmRzRGVjb2RlIH0gZnJvbSAnZW1haWxqcy1taW1lLWNvZGVjJ1xuaW1wb3J0IHsgVGV4dEVuY29kZXIgfSBmcm9tICd0ZXh0LWVuY29kaW5nJ1xuaW1wb3J0IHBhcnNlQWRkcmVzcyBmcm9tICdlbWFpbGpzLWFkZHJlc3NwYXJzZXInXG5cbi8qXG4gKiBDb3VudHMgTUlNRSBub2RlcyB0byBwcmV2ZW50IG1lbW9yeSBleGhhdXN0aW9uIGF0dGFja3MgKENXRS00MDApXG4gKiBzZWU6IGh0dHBzOi8vc255ay5pby92dWxuL25wbTplbWFpbGpzLW1pbWUtcGFyc2VyOjIwMTgwNjI1XG4gKi9cbmNvbnN0IE1BWElNVU1fTlVNQkVSX09GX01JTUVfTk9ERVMgPSA5OTlcbmV4cG9ydCBjbGFzcyBOb2RlQ291bnRlciB7XG4gIGNvbnN0cnVjdG9yICgpIHtcbiAgICB0aGlzLmNvdW50ID0gMFxuICB9XG4gIGJ1bXAgKCkge1xuICAgIGlmICgrK3RoaXMuY291bnQgPiBNQVhJTVVNX05VTUJFUl9PRl9NSU1FX05PREVTKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01heGltdW0gbnVtYmVyIG9mIE1JTUUgbm9kZXMgZXhjZWVkZWQhJylcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZm9yRWFjaExpbmUgKHN0ciwgY2FsbGJhY2spIHtcbiAgbGV0IGxpbmUgPSAnJ1xuICBsZXQgdGVybWluYXRvciA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgY2hhciA9IHN0cltpXVxuICAgIGlmIChjaGFyID09PSAnXFxyJyB8fCBjaGFyID09PSAnXFxuJykge1xuICAgICAgY29uc3QgbmV4dENoYXIgPSBzdHJbaSArIDFdXG4gICAgICB0ZXJtaW5hdG9yICs9IGNoYXJcbiAgICAgIC8vIERldGVjdCBXaW5kb3dzIGFuZCBNYWNpbnRvc2ggbGluZSB0ZXJtaW5hdG9ycy5cbiAgICAgIGlmICgodGVybWluYXRvciArIG5leHRDaGFyKSA9PT0gJ1xcclxcbicgfHwgKHRlcm1pbmF0b3IgKyBuZXh0Q2hhcikgPT09ICdcXG5cXHInKSB7XG4gICAgICAgIGNhbGxiYWNrKGxpbmUsIHRlcm1pbmF0b3IgKyBuZXh0Q2hhcilcbiAgICAgICAgbGluZSA9ICcnXG4gICAgICAgIHRlcm1pbmF0b3IgPSAnJ1xuICAgICAgICBpICs9IDFcbiAgICAgIC8vIERldGVjdCBzaW5nbGUtY2hhcmFjdGVyIHRlcm1pbmF0b3JzLCBsaWtlIExpbnV4IG9yIG90aGVyIHN5c3RlbS5cbiAgICAgIH0gZWxzZSBpZiAodGVybWluYXRvciA9PT0gJ1xcbicgfHwgdGVybWluYXRvciA9PT0gJ1xccicpIHtcbiAgICAgICAgY2FsbGJhY2sobGluZSwgdGVybWluYXRvcilcbiAgICAgICAgbGluZSA9ICcnXG4gICAgICAgIHRlcm1pbmF0b3IgPSAnJ1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lICs9IGNoYXJcbiAgICB9XG4gIH1cbiAgLy8gRmx1c2ggdGhlIGxpbmUgYW5kIHRlcm1pbmF0b3IgdmFsdWVzIGlmIG5lY2Vzc2FyeTsgaGFuZGxlIGVkZ2UgY2FzZXMgd2hlcmUgTUlNRSBpcyBnZW5lcmF0ZWQgd2l0aG91dCBsYXN0IGxpbmUgdGVybWluYXRvci5cbiAgaWYgKGxpbmUgIT09ICcnIHx8IHRlcm1pbmF0b3IgIT09ICcnKSB7XG4gICAgY2FsbGJhY2sobGluZSwgdGVybWluYXRvcilcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBwYXJzZSAoY2h1bmspIHtcbiAgY29uc3Qgcm9vdCA9IG5ldyBNaW1lTm9kZShuZXcgTm9kZUNvdW50ZXIoKSlcbiAgY29uc3Qgc3RyID0gdHlwZW9mIGNodW5rID09PSAnc3RyaW5nJyA/IGNodW5rIDogU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBjaHVuaylcbiAgZm9yRWFjaExpbmUoc3RyLCBmdW5jdGlvbiAobGluZSwgdGVybWluYXRvcikge1xuICAgIHJvb3Qud3JpdGVMaW5lKGxpbmUsIHRlcm1pbmF0b3IpXG4gIH0pXG4gIHJvb3QuZmluYWxpemUoKVxuICByZXR1cm4gcm9vdFxufVxuXG5leHBvcnQgY2xhc3MgTWltZU5vZGUge1xuICBjb25zdHJ1Y3RvciAobm9kZUNvdW50ZXIgPSBuZXcgTm9kZUNvdW50ZXIoKSkge1xuICAgIHRoaXMubm9kZUNvdW50ZXIgPSBub2RlQ291bnRlclxuICAgIHRoaXMubm9kZUNvdW50ZXIuYnVtcCgpXG5cbiAgICB0aGlzLmhlYWRlciA9IFtdIC8vIEFuIGFycmF5IG9mIHVuZm9sZGVkIGhlYWRlciBsaW5lc1xuICAgIHRoaXMuaGVhZGVycyA9IHt9IC8vIEFuIG9iamVjdCB0aGF0IGhvbGRzIGhlYWRlciBrZXk9dmFsdWUgcGFpcnNcbiAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgPSAnJ1xuICAgIHRoaXMuY2hpbGROb2RlcyA9IFtdIC8vIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgbWVzc2FnZS9yZmM4MjIgbWltZSBwYXJ0LCB0aGUgdmFsdWUgd2lsbCBiZSBjb252ZXJ0ZWQgdG8gYXJyYXkgYW5kIGhvbGQgYWxsIGNoaWxkIG5vZGVzIGZvciB0aGlzIG5vZGVcbiAgICB0aGlzLnJhdyA9ICcnIC8vIFN0b3JlcyB0aGUgcmF3IGNvbnRlbnQgb2YgdGhpcyBub2RlXG5cbiAgICB0aGlzLl9zdGF0ZSA9ICdIRUFERVInIC8vIEN1cnJlbnQgc3RhdGUsIGFsd2F5cyBzdGFydHMgb3V0IHdpdGggSEVBREVSXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnIC8vIEJvZHkgYnVmZmVyXG4gICAgdGhpcy5fbGluZUNvdW50ID0gMCAvLyBMaW5lIGNvdW50ZXIgYm9yIHRoZSBib2R5IHBhcnRcbiAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBmYWxzZSAvLyBBY3RpdmUgY2hpbGQgbm9kZSAoaWYgYXZhaWxhYmxlKVxuICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJyAvLyBSZW1haW5kZXIgc3RyaW5nIHdoZW4gZGVhbGluZyB3aXRoIGJhc2U2NCBhbmQgcXAgdmFsdWVzXG4gICAgdGhpcy5faXNNdWx0aXBhcnQgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSBmYWxzZSAvLyBTdG9yZXMgYm91bmRhcnkgdmFsdWUgZm9yIGN1cnJlbnQgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9pc1JmYzgyMiA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbWVzc2FnZS9yZmM4MjIgbm9kZVxuICB9XG5cbiAgd3JpdGVMaW5lIChsaW5lLCB0ZXJtaW5hdG9yKSB7XG4gICAgdGhpcy5yYXcgKz0gbGluZSArICh0ZXJtaW5hdG9yIHx8ICdcXG4nKVxuXG4gICAgaWYgKHRoaXMuX3N0YXRlID09PSAnSEVBREVSJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0hlYWRlckxpbmUobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3N0YXRlID09PSAnQk9EWScpIHtcbiAgICAgIHRoaXMuX3Byb2Nlc3NCb2R5TGluZShsaW5lLCB0ZXJtaW5hdG9yKVxuICAgIH1cbiAgfVxuXG4gIGZpbmFsaXplICgpIHtcbiAgICBpZiAodGhpcy5faXNSZmM4MjIpIHtcbiAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2VtaXRCb2R5KClcbiAgICB9XG5cbiAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgPSB0aGlzLmNoaWxkTm9kZXNcbiAgICAgIC5yZWR1Y2UoKGFnZywgY2hpbGQpID0+IGFnZyArICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICdcXG4nICsgY2hpbGQuYm9keXN0cnVjdHVyZSwgdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJykgK1xuICAgICAgKHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID8gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJy0tXFxuJyA6ICcnKVxuICB9XG5cbiAgX2RlY29kZUJvZHlCdWZmZXIgKCkge1xuICAgIHN3aXRjaCAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSkge1xuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciA9IGJhc2U2NERlY29kZSh0aGlzLl9ib2R5QnVmZmVyLCB0aGlzLmNoYXJzZXQpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdxdW90ZWQtcHJpbnRhYmxlJzoge1xuICAgICAgICB0aGlzLl9ib2R5QnVmZmVyID0gdGhpcy5fYm9keUJ1ZmZlclxuICAgICAgICAgIC5yZXBsYWNlKC89KFxccj9cXG58JCkvZywgJycpXG4gICAgICAgICAgLnJlcGxhY2UoLz0oW2EtZjAtOV17Mn0pL2lnLCAobSwgY29kZSkgPT4gU3RyaW5nLmZyb21DaGFyQ29kZShwYXJzZUludChjb2RlLCAxNikpKVxuICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgYSBsaW5lIGluIHRoZSBIRUFERVIgc3RhdGUuIEl0IHRoZSBsaW5lIGlzIGVtcHR5LCBjaGFuZ2Ugc3RhdGUgdG8gQk9EWVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICovXG4gIF9wcm9jZXNzSGVhZGVyTGluZSAobGluZSkge1xuICAgIGlmICghbGluZSkge1xuICAgICAgdGhpcy5fcGFyc2VIZWFkZXJzKClcbiAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSB0aGlzLmhlYWRlci5qb2luKCdcXG4nKSArICdcXG5cXG4nXG4gICAgICB0aGlzLl9zdGF0ZSA9ICdCT0RZJ1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGxpbmUubWF0Y2goL15cXHMvKSAmJiB0aGlzLmhlYWRlci5sZW5ndGgpIHtcbiAgICAgIHRoaXMuaGVhZGVyW3RoaXMuaGVhZGVyLmxlbmd0aCAtIDFdICs9ICdcXG4nICsgbGluZVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmhlYWRlci5wdXNoKGxpbmUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEpvaW5zIGZvbGRlZCBoZWFkZXIgbGluZXMgYW5kIGNhbGxzIENvbnRlbnQtVHlwZSBhbmQgVHJhbnNmZXItRW5jb2RpbmcgcHJvY2Vzc29yc1xuICAgKi9cbiAgX3BhcnNlSGVhZGVycyAoKSB7XG4gICAgZm9yIChsZXQgaGFzQmluYXJ5ID0gZmFsc2UsIGkgPSAwLCBsZW4gPSB0aGlzLmhlYWRlci5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgbGV0IHZhbHVlID0gdGhpcy5oZWFkZXJbaV0uc3BsaXQoJzonKVxuICAgICAgY29uc3Qga2V5ID0gKHZhbHVlLnNoaWZ0KCkgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgICB2YWx1ZSA9ICh2YWx1ZS5qb2luKCc6JykgfHwgJycpLnJlcGxhY2UoL1xcbi9nLCAnJykudHJpbSgpXG5cbiAgICAgIGlmICh2YWx1ZS5tYXRjaCgvW1xcdTAwODAtXFx1RkZGRl0vKSkge1xuICAgICAgICBpZiAoIXRoaXMuY2hhcnNldCkge1xuICAgICAgICAgIGhhc0JpbmFyeSA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICAvLyB1c2UgZGVmYXVsdCBjaGFyc2V0IGF0IGZpcnN0IGFuZCBpZiB0aGUgYWN0dWFsIGNoYXJzZXQgaXMgcmVzb2x2ZWQsIHRoZSBjb252ZXJzaW9uIGlzIHJlLXJ1blxuICAgICAgICB2YWx1ZSA9IGRlY29kZShjb252ZXJ0KHN0cjJhcnIodmFsdWUpLCB0aGlzLmNoYXJzZXQgfHwgJ2lzby04ODU5LTEnKSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5oZWFkZXJzW2tleV0gPSAodGhpcy5oZWFkZXJzW2tleV0gfHwgW10pLmNvbmNhdChbdGhpcy5fcGFyc2VIZWFkZXJWYWx1ZShrZXksIHZhbHVlKV0pXG5cbiAgICAgIGlmICghdGhpcy5jaGFyc2V0ICYmIGtleSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5oZWFkZXJzW2tleV1bdGhpcy5oZWFkZXJzW2tleV0ubGVuZ3RoIC0gMV0ucGFyYW1zLmNoYXJzZXRcbiAgICAgIH1cblxuICAgICAgaWYgKGhhc0JpbmFyeSAmJiB0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgLy8gcmVzZXQgdmFsdWVzIGFuZCBzdGFydCBvdmVyIG9uY2UgY2hhcnNldCBoYXMgYmVlbiByZXNvbHZlZCBhbmQgOGJpdCBjb250ZW50IGhhcyBiZWVuIGZvdW5kXG4gICAgICAgIGhhc0JpbmFyeSA9IGZhbHNlXG4gICAgICAgIHRoaXMuaGVhZGVycyA9IHt9XG4gICAgICAgIGkgPSAtMSAvLyBuZXh0IGl0ZXJhdGlvbiBoYXMgaSA9PSAwXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5mZXRjaENvbnRlbnRUeXBlKClcbiAgICB0aGlzLl9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBzaW5nbGUgaGVhZGVyIHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkgSGVhZGVyIGtleVxuICAgKiBAcGFyYW0ge1N0cmluZ30gdmFsdWUgVmFsdWUgZm9yIHRoZSBrZXlcbiAgICogQHJldHVybiB7T2JqZWN0fSBwYXJzZWQgaGVhZGVyXG4gICAqL1xuICBfcGFyc2VIZWFkZXJWYWx1ZSAoa2V5LCB2YWx1ZSkge1xuICAgIGxldCBwYXJzZWRWYWx1ZVxuICAgIGxldCBpc0FkZHJlc3MgPSBmYWxzZVxuXG4gICAgc3dpdGNoIChrZXkpIHtcbiAgICAgIGNhc2UgJ2NvbnRlbnQtdHlwZSc6XG4gICAgICBjYXNlICdjb250ZW50LXRyYW5zZmVyLWVuY29kaW5nJzpcbiAgICAgIGNhc2UgJ2NvbnRlbnQtZGlzcG9zaXRpb24nOlxuICAgICAgY2FzZSAnZGtpbS1zaWduYXR1cmUnOlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUodmFsdWUpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdmcm9tJzpcbiAgICAgIGNhc2UgJ3NlbmRlcic6XG4gICAgICBjYXNlICd0byc6XG4gICAgICBjYXNlICdyZXBseS10byc6XG4gICAgICBjYXNlICdjYyc6XG4gICAgICBjYXNlICdiY2MnOlxuICAgICAgY2FzZSAnYWJ1c2UtcmVwb3J0cy10byc6XG4gICAgICBjYXNlICdlcnJvcnMtdG8nOlxuICAgICAgY2FzZSAncmV0dXJuLXBhdGgnOlxuICAgICAgY2FzZSAnZGVsaXZlcmVkLXRvJzpcbiAgICAgICAgaXNBZGRyZXNzID0gdHJ1ZVxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogW10uY29uY2F0KHBhcnNlQWRkcmVzcyh2YWx1ZSkgfHwgW10pXG4gICAgICAgIH1cbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogdGhpcy5fcGFyc2VEYXRlKHZhbHVlKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogdmFsdWVcbiAgICAgICAgfVxuICAgIH1cbiAgICBwYXJzZWRWYWx1ZS5pbml0aWFsID0gdmFsdWVcblxuICAgIHRoaXMuX2RlY29kZUhlYWRlckNoYXJzZXQocGFyc2VkVmFsdWUsIHsgaXNBZGRyZXNzIH0pXG5cbiAgICByZXR1cm4gcGFyc2VkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBkYXRlIHN0cmluZyBjYW4gYmUgcGFyc2VkLiBGYWxscyBiYWNrIHJlcGxhY2luZyB0aW1lem9uZVxuICAgKiBhYmJyZXZhdGlvbnMgd2l0aCB0aW1lem9uZSB2YWx1ZXMuIEJvZ3VzIHRpbWV6b25lcyBkZWZhdWx0IHRvIFVUQy5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IHN0ciBEYXRlIGhlYWRlclxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBVVEMgZGF0ZSBzdHJpbmcgaWYgcGFyc2luZyBzdWNjZWVkZWQsIG90aGVyd2lzZSByZXR1cm5zIGlucHV0IHZhbHVlXG4gICAqL1xuICBfcGFyc2VEYXRlIChzdHIgPSAnJykge1xuICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZShzdHIudHJpbSgpLnJlcGxhY2UoL1xcYlthLXpdKyQvaSwgdHogPT4gdGltZXpvbmVbdHoudG9VcHBlckNhc2UoKV0gfHwgJyswMDAwJykpXG4gICAgcmV0dXJuIChkYXRlLnRvU3RyaW5nKCkgIT09ICdJbnZhbGlkIERhdGUnKSA/IGRhdGUudG9VVENTdHJpbmcoKS5yZXBsYWNlKC9HTVQvLCAnKzAwMDAnKSA6IHN0clxuICB9XG5cbiAgX2RlY29kZUhlYWRlckNoYXJzZXQgKHBhcnNlZCwgeyBpc0FkZHJlc3MgfSA9IHt9KSB7XG4gICAgLy8gZGVjb2RlIGRlZmF1bHQgdmFsdWVcbiAgICBpZiAodHlwZW9mIHBhcnNlZC52YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHBhcnNlZC52YWx1ZSA9IG1pbWVXb3Jkc0RlY29kZShwYXJzZWQudmFsdWUpXG4gICAgfVxuXG4gICAgLy8gZGVjb2RlIHBvc3NpYmxlIHBhcmFtc1xuICAgIE9iamVjdC5rZXlzKHBhcnNlZC5wYXJhbXMgfHwge30pLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgICAgaWYgKHR5cGVvZiBwYXJzZWQucGFyYW1zW2tleV0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHBhcnNlZC5wYXJhbXNba2V5XSA9IG1pbWVXb3Jkc0RlY29kZShwYXJzZWQucGFyYW1zW2tleV0pXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIGRlY29kZSBhZGRyZXNzZXNcbiAgICBpZiAoaXNBZGRyZXNzICYmIEFycmF5LmlzQXJyYXkocGFyc2VkLnZhbHVlKSkge1xuICAgICAgcGFyc2VkLnZhbHVlLmZvckVhY2goYWRkciA9PiB7XG4gICAgICAgIGlmIChhZGRyLm5hbWUpIHtcbiAgICAgICAgICBhZGRyLm5hbWUgPSBtaW1lV29yZHNEZWNvZGUoYWRkci5uYW1lKVxuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGFkZHIuZ3JvdXApKSB7XG4gICAgICAgICAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHsgdmFsdWU6IGFkZHIuZ3JvdXAgfSwgeyBpc0FkZHJlc3M6IHRydWUgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcnNlZFxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBDb250ZW50LVR5cGUgdmFsdWUgYW5kIHNlbGVjdHMgZm9sbG93aW5nIGFjdGlvbnMuXG4gICAqL1xuICBmZXRjaENvbnRlbnRUeXBlICgpIHtcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCd0ZXh0L3BsYWluJylcbiAgICB0aGlzLmNvbnRlbnRUeXBlID0gcGF0aE9yKGRlZmF1bHRWYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtdHlwZScsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHlwZS52YWx1ZSA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICAgIHRoaXMuY29udGVudFR5cGUudHlwZSA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlLnNwbGl0KCcvJykuc2hpZnQoKSB8fCAndGV4dCcpXG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS5wYXJhbXMgJiYgdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldCAmJiAhdGhpcy5jaGFyc2V0KSB7XG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudHlwZSA9PT0gJ211bHRpcGFydCcgJiYgdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuYm91bmRhcnkpIHtcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFtdXG4gICAgICB0aGlzLl9pc011bHRpcGFydCA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlLnNwbGl0KCcvJykucG9wKCkgfHwgJ21peGVkJylcbiAgICAgIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuYm91bmRhcnlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBGb3IgYXR0YWNobWVudCAoaW5saW5lL3JlZ3VsYXIpIGlmIGNoYXJzZXQgaXMgbm90IGRlZmluZWQgYW5kIGF0dGFjaG1lbnQgaXMgbm9uLXRleHQvKixcbiAgICAgKiB0aGVuIGRlZmF1bHQgY2hhcnNldCB0byBiaW5hcnkuXG4gICAgICogUmVmZXIgdG8gaXNzdWU6IGh0dHBzOi8vZ2l0aHViLmNvbS9lbWFpbGpzL2VtYWlsanMtbWltZS1wYXJzZXIvaXNzdWVzLzE4XG4gICAgICovXG4gICAgY29uc3QgZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgnJylcbiAgICBjb25zdCBjb250ZW50RGlzcG9zaXRpb24gPSBwYXRoT3IoZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC1kaXNwb3NpdGlvbicsICcwJ10pKHRoaXMpXG4gICAgY29uc3QgaXNBdHRhY2htZW50ID0gKGNvbnRlbnREaXNwb3NpdGlvbi52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKCkgPT09ICdhdHRhY2htZW50J1xuICAgIGNvbnN0IGlzSW5saW5lQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnaW5saW5lJ1xuICAgIGlmICgoaXNBdHRhY2htZW50IHx8IGlzSW5saW5lQXR0YWNobWVudCkgJiYgdGhpcy5jb250ZW50VHlwZS50eXBlICE9PSAndGV4dCcgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gJ2JpbmFyeSdcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS52YWx1ZSA9PT0gJ21lc3NhZ2UvcmZjODIyJyAmJiAhaXNBdHRhY2htZW50KSB7XG4gICAgICAvKipcbiAgICAgICAqIFBhcnNlIG1lc3NhZ2UvcmZjODIyIG9ubHkgaWYgdGhlIG1pbWUgcGFydCBpcyBub3QgbWFya2VkIHdpdGggY29udGVudC1kaXNwb3NpdGlvbjogYXR0YWNobWVudCxcbiAgICAgICAqIG90aGVyd2lzZSB0cmVhdCBpdCBsaWtlIGEgcmVndWxhciBhdHRhY2htZW50XG4gICAgICAgKi9cbiAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IG5ldyBNaW1lTm9kZSh0aGlzLm5vZGVDb3VudGVyKVxuICAgICAgdGhpcy5jaGlsZE5vZGVzID0gW3RoaXMuX2N1cnJlbnRDaGlsZF1cbiAgICAgIHRoaXMuX2lzUmZjODIyID0gdHJ1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UcmFuc2Zlci1FbmNvZGluZyB2YWx1ZSB0byBzZWUgaWYgdGhlIGJvZHkgbmVlZHMgdG8gYmUgY29udmVydGVkXG4gICAqIGJlZm9yZSBpdCBjYW4gYmUgZW1pdHRlZFxuICAgKi9cbiAgX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgnN2JpdCcpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZyA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXRyYW5zZmVyLWVuY29kaW5nJywgJzAnXSkodGhpcylcbiAgICB0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlID0gcGF0aE9yKCcnLCBbJ2NvbnRlbnRUcmFuc2ZlckVuY29kaW5nJywgJ3ZhbHVlJ10pKHRoaXMpLnRvTG93ZXJDYXNlKCkudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgQk9EWSBzdGF0ZS4gSWYgdGhpcyBpcyBhIG11bHRpcGFydCBvciByZmM4MjIgbm9kZSxcbiAgICogcGFzc2VzIGxpbmUgdmFsdWUgdG8gY2hpbGQgbm9kZXMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBsaW5lIEVudGlyZSBpbnB1dCBsaW5lIGFzICdiaW5hcnknIHN0cmluZ1xuICAgKiBAcGFyYW0ge1N0cmluZ30gdGVybWluYXRvciBUaGUgbGluZSB0ZXJtaW5hdG9yIGRldGVjdGVkIGJ5IHBhcnNlclxuICAgKi9cbiAgX3Byb2Nlc3NCb2R5TGluZSAobGluZSwgdGVybWluYXRvcikge1xuICAgIGlmICh0aGlzLl9pc011bHRpcGFydCkge1xuICAgICAgaWYgKGxpbmUgPT09ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSkge1xuICAgICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gbGluZSArICdcXG4nXG4gICAgICAgIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IG5ldyBNaW1lTm9kZSh0aGlzLm5vZGVDb3VudGVyKVxuICAgICAgICB0aGlzLmNoaWxkTm9kZXMucHVzaCh0aGlzLl9jdXJyZW50Q2hpbGQpXG4gICAgICB9IGVsc2UgaWYgKGxpbmUgPT09ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICctLScpIHtcbiAgICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IGxpbmUgKyAnXFxuJ1xuICAgICAgICBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBmYWxzZVxuICAgICAgfSBlbHNlIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLndyaXRlTGluZShsaW5lLCB0ZXJtaW5hdG9yKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gSWdub3JlIG11bHRpcGFydCBwcmVhbWJsZVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5faXNSZmM4MjIpIHtcbiAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC53cml0ZUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fbGluZUNvdW50KytcblxuICAgICAgc3dpdGNoICh0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlKSB7XG4gICAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciArPSBsaW5lICsgdGVybWluYXRvclxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJ3F1b3RlZC1wcmludGFibGUnOiB7XG4gICAgICAgICAgbGV0IGN1ckxpbmUgPSB0aGlzLl9saW5lUmVtYWluZGVyICsgbGluZSArIHRlcm1pbmF0b3JcbiAgICAgICAgICBjb25zdCBtYXRjaCA9IGN1ckxpbmUubWF0Y2goLz1bYS1mMC05XXswLDF9JC9pKVxuICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9IG1hdGNoWzBdXG4gICAgICAgICAgICBjdXJMaW5lID0gY3VyTGluZS5zdWJzdHIoMCwgY3VyTGluZS5sZW5ndGggLSB0aGlzLl9saW5lUmVtYWluZGVyLmxlbmd0aClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnXG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gY3VyTGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnN2JpdCc6XG4gICAgICAgIGNhc2UgJzhiaXQnOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gbGluZSArIHRlcm1pbmF0b3JcbiAgICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBhIGNodW5rIG9mIHRoZSBib2R5XG4gICovXG4gIF9lbWl0Qm9keSAoKSB7XG4gICAgdGhpcy5fZGVjb2RlQm9keUJ1ZmZlcigpXG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0IHx8ICF0aGlzLl9ib2R5QnVmZmVyKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9wcm9jZXNzRmxvd2VkVGV4dCgpXG4gICAgdGhpcy5jb250ZW50ID0gc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKVxuICAgIHRoaXMuX3Byb2Nlc3NIdG1sVGV4dCgpXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnXG4gIH1cblxuICBfcHJvY2Vzc0Zsb3dlZFRleHQgKCkge1xuICAgIGNvbnN0IGlzVGV4dCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNGbG93ZWQgPSAvXmZsb3dlZCQvaS50ZXN0KHBhdGhPcignJywgWydjb250ZW50VHlwZScsICdwYXJhbXMnLCAnZm9ybWF0J10pKHRoaXMpKVxuICAgIGlmICghaXNUZXh0IHx8ICFpc0Zsb3dlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWxTcCA9IC9eeWVzJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS5wYXJhbXMuZGVsc3ApXG4gICAgbGV0IGJvZHlCdWZmZXIgPSAnJ1xuXG4gICAgZm9yRWFjaExpbmUodGhpcy5fYm9keUJ1ZmZlciwgZnVuY3Rpb24gKGxpbmUsIHRlcm1pbmF0b3IpIHtcbiAgICAgIC8vIHJlbW92ZSBzb2Z0IGxpbmVicmVha3MgYWZ0ZXIgc3BhY2Ugc3ltYm9scy5cbiAgICAgIC8vIGRlbHNwIGFkZHMgc3BhY2VzIHRvIHRleHQgdG8gYmUgYWJsZSB0byBmb2xkIGl0LlxuICAgICAgLy8gdGhlc2Ugc3BhY2VzIGNhbiBiZSByZW1vdmVkIG9uY2UgdGhlIHRleHQgaXMgdW5mb2xkZWRcbiAgICAgIGNvbnN0IGVuZHNXaXRoU3BhY2UgPSAvICQvLnRlc3QobGluZSlcbiAgICAgIGNvbnN0IGlzQm91bmRhcnkgPSAvKF58XFxuKS0tICQvLnRlc3QobGluZSlcblxuICAgICAgYm9keUJ1ZmZlciArPSAoZGVsU3AgPyBsaW5lLnJlcGxhY2UoL1sgXSskLywgJycpIDogbGluZSkgKyAoKGVuZHNXaXRoU3BhY2UgJiYgIWlzQm91bmRhcnkpID8gJycgOiB0ZXJtaW5hdG9yKVxuICAgIH0pXG5cbiAgICB0aGlzLl9ib2R5QnVmZmVyID0gYm9keUJ1ZmZlci5yZXBsYWNlKC9eIC9nbSwgJycpIC8vIHJlbW92ZSB3aGl0ZXNwYWNlIHN0dWZmaW5nIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM2NzYjc2VjdGlvbi00LjRcbiAgfVxuXG4gIF9wcm9jZXNzSHRtbFRleHQgKCkge1xuICAgIGNvbnN0IGNvbnRlbnREaXNwb3NpdGlvbiA9ICh0aGlzLmhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSAmJiB0aGlzLmhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXVswXSkgfHwgcGFyc2VIZWFkZXJWYWx1ZSgnJylcbiAgICBjb25zdCBpc0h0bWwgPSAvXnRleHRcXC8ocGxhaW58aHRtbCkkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IC9eYXR0YWNobWVudCQvaS50ZXN0KGNvbnRlbnREaXNwb3NpdGlvbi52YWx1ZSlcbiAgICBpZiAoaXNIdG1sICYmICFpc0F0dGFjaG1lbnQpIHtcbiAgICAgIGlmICghdGhpcy5jaGFyc2V0ICYmIC9edGV4dFxcL2h0bWwkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKSkge1xuICAgICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmRldGVjdEhUTUxDaGFyc2V0KHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgICB9XG5cbiAgICAgIC8vIGRlY29kZSBcImJpbmFyeVwiIHN0cmluZyB0byBhbiB1bmljb2RlIHN0cmluZ1xuICAgICAgaWYgKCEvXnV0ZlstX10/OCQvaS50ZXN0KHRoaXMuY2hhcnNldCkpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gY29udmVydChzdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpLCB0aGlzLmNoYXJzZXQgfHwgJ2lzby04ODU5LTEnKVxuICAgICAgfSBlbHNlIGlmICh0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlID09PSAnYmFzZTY0Jykge1xuICAgICAgICB0aGlzLmNvbnRlbnQgPSB1dGY4U3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKVxuICAgICAgfVxuXG4gICAgICAvLyBvdmVycmlkZSBjaGFyc2V0IGZvciB0ZXh0IG5vZGVzXG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ID0gJ3V0Zi04J1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlY3QgY2hhcnNldCBmcm9tIGEgaHRtbCBmaWxlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBodG1sIElucHV0IEhUTUxcbiAgICogQHJldHVybnMge1N0cmluZ30gQ2hhcnNldCBpZiBmb3VuZCBvciB1bmRlZmluZWRcbiAgICovXG4gIGRldGVjdEhUTUxDaGFyc2V0IChodG1sKSB7XG4gICAgbGV0IGNoYXJzZXQsIGlucHV0XG5cbiAgICBodG1sID0gaHRtbC5yZXBsYWNlKC9cXHI/XFxufFxcci9nLCAnICcpXG4gICAgbGV0IG1ldGEgPSBodG1sLm1hdGNoKC88bWV0YVxccytodHRwLWVxdWl2PVtcIidcXHNdKmNvbnRlbnQtdHlwZVtePl0qPz4vaSlcbiAgICBpZiAobWV0YSkge1xuICAgICAgaW5wdXQgPSBtZXRhWzBdXG4gICAgfVxuXG4gICAgaWYgKGlucHV0KSB7XG4gICAgICBjaGFyc2V0ID0gaW5wdXQubWF0Y2goL2NoYXJzZXRcXHM/PVxccz8oW2EtekEtWlxcLV86MC05XSopOz8vKVxuICAgICAgaWYgKGNoYXJzZXQpIHtcbiAgICAgICAgY2hhcnNldCA9IChjaGFyc2V0WzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgfVxuICAgIH1cblxuICAgIG1ldGEgPSBodG1sLm1hdGNoKC88bWV0YVxccytjaGFyc2V0PVtcIidcXHNdKihbXlwiJzw+L1xcc10rKS9pKVxuICAgIGlmICghY2hhcnNldCAmJiBtZXRhKSB7XG4gICAgICBjaGFyc2V0ID0gKG1ldGFbMV0gfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYXJzZXRcbiAgfVxufVxuXG5jb25zdCBzdHIyYXJyID0gc3RyID0+IG5ldyBVaW50OEFycmF5KHN0ci5zcGxpdCgnJykubWFwKGNoYXIgPT4gY2hhci5jaGFyQ29kZUF0KDApKSlcbmNvbnN0IHV0ZjhTdHIyYXJyID0gc3RyID0+IG5ldyBUZXh0RW5jb2RlcigndXRmLTgnKS5lbmNvZGUoc3RyKVxuIl19
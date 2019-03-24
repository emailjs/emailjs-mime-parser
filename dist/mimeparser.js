'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MimeNode = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

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

function parse(chunk) {
  var root = new MimeNode();
  var lines = ((typeof chunk === 'undefined' ? 'undefined' : _typeof(chunk)) === 'object' ? String.fromCharCode.apply(null, chunk) : chunk).split(/\r?\n/g);
  lines.forEach(function (line) {
    return root.writeLine(line);
  });
  root.finalize();
  return root;
}

var MimeNode = exports.MimeNode = function () {
  function MimeNode() {
    _classCallCheck(this, MimeNode);

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
    value: function writeLine(line) {
      this.raw += (this.raw ? '\n' : '') + line;

      if (this._state === 'HEADER') {
        this._processHeaderLine(line);
      } else if (this._state === 'BODY') {
        this._processBodyLine(line);
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
        this._currentChild = new MimeNode(this);
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
     */

  }, {
    key: '_processBodyLine',
    value: function _processBodyLine(line) {
      if (this._isMultipart) {
        if (line === '--' + this._multipartBoundary) {
          this.bodystructure += line + '\n';
          if (this._currentChild) {
            this._currentChild.finalize();
          }
          this._currentChild = new MimeNode(this);
          this.childNodes.push(this._currentChild);
        } else if (line === '--' + this._multipartBoundary + '--') {
          this.bodystructure += line + '\n';
          if (this._currentChild) {
            this._currentChild.finalize();
          }
          this._currentChild = false;
        } else if (this._currentChild) {
          this._currentChild.writeLine(line);
        } else {
          // Ignore multipart preamble
        }
      } else if (this._isRfc822) {
        this._currentChild.writeLine(line);
      } else {
        this._lineCount++;

        switch (this.contentTransferEncoding.value) {
          case 'base64':
            this._bodyBuffer += line;
            break;
          case 'quoted-printable':
            {
              var curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line;
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
            this._bodyBuffer += (this._lineCount > 1 ? '\n' : '') + line;
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
      this._bodyBuffer = this._bodyBuffer.split('\n').reduce(function (previousValue, currentValue) {
        // remove soft linebreaks after space symbols.
        // delsp adds spaces to text to be able to fold it.
        // these spaces can be removed once the text is unfolded
        var endsWithSpace = / $/.test(previousValue);
        var isBoundary = /(^|\n)-- $/.test(previousValue);
        return (delSp ? previousValue.replace(/[ ]+$/, '') : previousValue) + (endsWithSpace && !isBoundary ? '' : '\n') + currentValue;
      }).replace(/^ /gm, ''); // remove whitespace stuffing http://tools.ietf.org/html/rfc3676#section-4.4
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taW1lcGFyc2VyLmpzIl0sIm5hbWVzIjpbInBhcnNlIiwiY2h1bmsiLCJyb290IiwiTWltZU5vZGUiLCJsaW5lcyIsIlN0cmluZyIsImZyb21DaGFyQ29kZSIsImFwcGx5Iiwic3BsaXQiLCJmb3JFYWNoIiwid3JpdGVMaW5lIiwibGluZSIsImZpbmFsaXplIiwiaGVhZGVyIiwiaGVhZGVycyIsImJvZHlzdHJ1Y3R1cmUiLCJjaGlsZE5vZGVzIiwicmF3IiwiX3N0YXRlIiwiX2JvZHlCdWZmZXIiLCJfbGluZUNvdW50IiwiX2N1cnJlbnRDaGlsZCIsIl9saW5lUmVtYWluZGVyIiwiX2lzTXVsdGlwYXJ0IiwiX211bHRpcGFydEJvdW5kYXJ5IiwiX2lzUmZjODIyIiwiX3Byb2Nlc3NIZWFkZXJMaW5lIiwiX3Byb2Nlc3NCb2R5TGluZSIsIl9lbWl0Qm9keSIsInJlZHVjZSIsImFnZyIsImNoaWxkIiwiam9pbiIsImNvbnRlbnRUcmFuc2ZlckVuY29kaW5nIiwidmFsdWUiLCJjaGFyc2V0IiwicmVwbGFjZSIsIm0iLCJjb2RlIiwicGFyc2VJbnQiLCJfcGFyc2VIZWFkZXJzIiwibWF0Y2giLCJsZW5ndGgiLCJwdXNoIiwiaGFzQmluYXJ5IiwiaSIsImxlbiIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwic3RyMmFyciIsImNvbmNhdCIsIl9wYXJzZUhlYWRlclZhbHVlIiwicGFyYW1zIiwiZmV0Y2hDb250ZW50VHlwZSIsIl9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJwYXJzZWRWYWx1ZSIsImlzQWRkcmVzcyIsIl9wYXJzZURhdGUiLCJpbml0aWFsIiwiX2RlY29kZUhlYWRlckNoYXJzZXQiLCJzdHIiLCJkYXRlIiwiRGF0ZSIsInRpbWV6b25lIiwidHoiLCJ0b1VwcGVyQ2FzZSIsInRvU3RyaW5nIiwidG9VVENTdHJpbmciLCJwYXJzZWQiLCJPYmplY3QiLCJrZXlzIiwiQXJyYXkiLCJpc0FycmF5IiwiYWRkciIsIm5hbWUiLCJncm91cCIsImRlZmF1bHRWYWx1ZSIsImNvbnRlbnRUeXBlIiwidHlwZSIsImJvdW5kYXJ5IiwicG9wIiwiZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlIiwiY29udGVudERpc3Bvc2l0aW9uIiwiaXNBdHRhY2htZW50IiwiaXNJbmxpbmVBdHRhY2htZW50IiwiY3VyTGluZSIsInN1YnN0ciIsIl9kZWNvZGVCb2R5QnVmZmVyIiwiX3Byb2Nlc3NGbG93ZWRUZXh0IiwiY29udGVudCIsIl9wcm9jZXNzSHRtbFRleHQiLCJpc1RleHQiLCJ0ZXN0IiwiaXNGbG93ZWQiLCJkZWxTcCIsImRlbHNwIiwicHJldmlvdXNWYWx1ZSIsImN1cnJlbnRWYWx1ZSIsImVuZHNXaXRoU3BhY2UiLCJpc0JvdW5kYXJ5IiwiaXNIdG1sIiwiZGV0ZWN0SFRNTENoYXJzZXQiLCJ1dGY4U3RyMmFyciIsImh0bWwiLCJpbnB1dCIsIm1ldGEiLCJVaW50OEFycmF5IiwibWFwIiwiY2hhciIsImNoYXJDb2RlQXQiLCJUZXh0RW5jb2RlciIsImVuY29kZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7a0JBTXdCQSxLOztBQU54Qjs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOzs7Ozs7OztBQUVlLFNBQVNBLEtBQVQsQ0FBZ0JDLEtBQWhCLEVBQXVCO0FBQ3BDLE1BQU1DLE9BQU8sSUFBSUMsUUFBSixFQUFiO0FBQ0EsTUFBTUMsUUFBUSxDQUFDLFFBQU9ILEtBQVAseUNBQU9BLEtBQVAsT0FBaUIsUUFBakIsR0FBNEJJLE9BQU9DLFlBQVAsQ0FBb0JDLEtBQXBCLENBQTBCLElBQTFCLEVBQWdDTixLQUFoQyxDQUE1QixHQUFxRUEsS0FBdEUsRUFBNkVPLEtBQTdFLENBQW1GLFFBQW5GLENBQWQ7QUFDQUosUUFBTUssT0FBTixDQUFjO0FBQUEsV0FBUVAsS0FBS1EsU0FBTCxDQUFlQyxJQUFmLENBQVI7QUFBQSxHQUFkO0FBQ0FULE9BQUtVLFFBQUw7QUFDQSxTQUFPVixJQUFQO0FBQ0Q7O0lBRVlDLFEs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QUFJa0UsSUFBSixFQUFVO0FBQ1JELGdCQUFRQyxLQUFLLENBQUwsQ0FBUjtBQUNEOztBQUVELFVBQUlELEtBQUosRUFBVztBQUNUdkUsa0JBQVV1RSxNQUFNakUsS0FBTixDQUFZLG9DQUFaLENBQVY7QUFDQSxZQUFJTixPQUFKLEVBQWE7QUFDWEEsb0JBQVUsQ0FBQ0EsUUFBUSxDQUFSLEtBQWMsRUFBZixFQUFtQmMsSUFBbkIsR0FBMEJDLFdBQTFCLEVBQVY7QUFDRDtBQUNGOztBQUVEeUQsYUFBT0YsS0FBS2hFLEtBQUwsQ0FBVyx1Q0FBWCxDQUFQO0FBQ0EsVUFBSSxDQUFDTixPQUFELElBQVl3RSxJQUFoQixFQUFzQjtBQUNwQnhFLGtCQUFVLENBQUN3RSxLQUFLLENBQUwsS0FBVyxFQUFaLEVBQWdCMUQsSUFBaEIsR0FBdUJDLFdBQXZCLEVBQVY7QUFDRDs7QUFFRCxhQUFPZixPQUFQO0FBQ0Q7Ozs7OztBQUdILElBQU1nQixVQUFVLFNBQVZBLE9BQVU7QUFBQSxTQUFPLElBQUl5RCxVQUFKLENBQWU5QyxJQUFJdEQsS0FBSixDQUFVLEVBQVYsRUFBY3FHLEdBQWQsQ0FBa0I7QUFBQSxXQUFRQyxLQUFLQyxVQUFMLENBQWdCLENBQWhCLENBQVI7QUFBQSxHQUFsQixDQUFmLENBQVA7QUFBQSxDQUFoQjtBQUNBLElBQU1QLGNBQWMsU0FBZEEsV0FBYztBQUFBLFNBQU8sSUFBSVEseUJBQUosQ0FBZ0IsT0FBaEIsRUFBeUJDLE1BQXpCLENBQWdDbkQsR0FBaEMsQ0FBUDtBQUFBLENBQXBCIiwiZmlsZSI6Im1pbWVwYXJzZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBwYXRoT3IgfSBmcm9tICdyYW1kYSdcbmltcG9ydCB0aW1lem9uZSBmcm9tICcuL3RpbWV6b25lcydcbmltcG9ydCB7IGRlY29kZSwgYmFzZTY0RGVjb2RlLCBjb252ZXJ0LCBwYXJzZUhlYWRlclZhbHVlLCBtaW1lV29yZHNEZWNvZGUgfSBmcm9tICdlbWFpbGpzLW1pbWUtY29kZWMnXG5pbXBvcnQgeyBUZXh0RW5jb2RlciB9IGZyb20gJ3RleHQtZW5jb2RpbmcnXG5pbXBvcnQgcGFyc2VBZGRyZXNzIGZyb20gJ2VtYWlsanMtYWRkcmVzc3BhcnNlcidcblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gcGFyc2UgKGNodW5rKSB7XG4gIGNvbnN0IHJvb3QgPSBuZXcgTWltZU5vZGUoKVxuICBjb25zdCBsaW5lcyA9ICh0eXBlb2YgY2h1bmsgPT09ICdvYmplY3QnID8gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBjaHVuaykgOiBjaHVuaykuc3BsaXQoL1xccj9cXG4vZylcbiAgbGluZXMuZm9yRWFjaChsaW5lID0+IHJvb3Qud3JpdGVMaW5lKGxpbmUpKVxuICByb290LmZpbmFsaXplKClcbiAgcmV0dXJuIHJvb3Rcbn1cblxuZXhwb3J0IGNsYXNzIE1pbWVOb2RlIHtcbiAgY29uc3RydWN0b3IgKCkge1xuICAgIHRoaXMuaGVhZGVyID0gW10gLy8gQW4gYXJyYXkgb2YgdW5mb2xkZWQgaGVhZGVyIGxpbmVzXG4gICAgdGhpcy5oZWFkZXJzID0ge30gLy8gQW4gb2JqZWN0IHRoYXQgaG9sZHMgaGVhZGVyIGtleT12YWx1ZSBwYWlyc1xuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9ICcnXG4gICAgdGhpcy5jaGlsZE5vZGVzID0gW10gLy8gSWYgdGhpcyBpcyBhIG11bHRpcGFydCBvciBtZXNzYWdlL3JmYzgyMiBtaW1lIHBhcnQsIHRoZSB2YWx1ZSB3aWxsIGJlIGNvbnZlcnRlZCB0byBhcnJheSBhbmQgaG9sZCBhbGwgY2hpbGQgbm9kZXMgZm9yIHRoaXMgbm9kZVxuICAgIHRoaXMucmF3ID0gJycgLy8gU3RvcmVzIHRoZSByYXcgY29udGVudCBvZiB0aGlzIG5vZGVcblxuICAgIHRoaXMuX3N0YXRlID0gJ0hFQURFUicgLy8gQ3VycmVudCBzdGF0ZSwgYWx3YXlzIHN0YXJ0cyBvdXQgd2l0aCBIRUFERVJcbiAgICB0aGlzLl9ib2R5QnVmZmVyID0gJycgLy8gQm9keSBidWZmZXJcbiAgICB0aGlzLl9saW5lQ291bnQgPSAwIC8vIExpbmUgY291bnRlciBib3IgdGhlIGJvZHkgcGFydFxuICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlIC8vIEFjdGl2ZSBjaGlsZCBub2RlIChpZiBhdmFpbGFibGUpXG4gICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnIC8vIFJlbWFpbmRlciBzdHJpbmcgd2hlbiBkZWFsaW5nIHdpdGggYmFzZTY0IGFuZCBxcCB2YWx1ZXNcbiAgICB0aGlzLl9pc011bHRpcGFydCA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IGZhbHNlIC8vIFN0b3JlcyBib3VuZGFyeSB2YWx1ZSBmb3IgY3VycmVudCBtdWx0aXBhcnQgbm9kZVxuICAgIHRoaXMuX2lzUmZjODIyID0gZmFsc2UgLy8gSW5kaWNhdGVzIGlmIHRoaXMgaXMgYSBtZXNzYWdlL3JmYzgyMiBub2RlXG4gIH1cblxuICB3cml0ZUxpbmUgKGxpbmUpIHtcbiAgICB0aGlzLnJhdyArPSAodGhpcy5yYXcgPyAnXFxuJyA6ICcnKSArIGxpbmVcblxuICAgIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0hFQURFUicpIHtcbiAgICAgIHRoaXMuX3Byb2Nlc3NIZWFkZXJMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0JPRFknKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzQm9keUxpbmUobGluZSlcbiAgICB9XG4gIH1cblxuICBmaW5hbGl6ZSAoKSB7XG4gICAgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9lbWl0Qm9keSgpXG4gICAgfVxuXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gdGhpcy5jaGlsZE5vZGVzXG4gICAgICAucmVkdWNlKChhZ2csIGNoaWxkKSA9PiBhZ2cgKyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnXFxuJyArIGNoaWxkLmJvZHlzdHJ1Y3R1cmUsIHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbicpICtcbiAgICAgICh0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA/ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICctLVxcbicgOiAnJylcbiAgfVxuXG4gIF9kZWNvZGVCb2R5QnVmZmVyICgpIHtcbiAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgPSBiYXNlNjREZWNvZGUodGhpcy5fYm9keUJ1ZmZlciwgdGhpcy5jaGFyc2V0KVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6IHtcbiAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciA9IHRoaXMuX2JvZHlCdWZmZXJcbiAgICAgICAgICAucmVwbGFjZSgvPShcXHI/XFxufCQpL2csICcnKVxuICAgICAgICAgIC5yZXBsYWNlKC89KFthLWYwLTldezJ9KS9pZywgKG0sIGNvZGUpID0+IFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoY29kZSwgMTYpKSlcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgSEVBREVSIHN0YXRlLiBJdCB0aGUgbGluZSBpcyBlbXB0eSwgY2hhbmdlIHN0YXRlIHRvIEJPRFlcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0hlYWRlckxpbmUgKGxpbmUpIHtcbiAgICBpZiAoIWxpbmUpIHtcbiAgICAgIHRoaXMuX3BhcnNlSGVhZGVycygpXG4gICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJ1xuICAgICAgdGhpcy5fc3RhdGUgPSAnQk9EWSdcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChsaW5lLm1hdGNoKC9eXFxzLykgJiYgdGhpcy5oZWFkZXIubGVuZ3RoKSB7XG4gICAgICB0aGlzLmhlYWRlclt0aGlzLmhlYWRlci5sZW5ndGggLSAxXSArPSAnXFxuJyArIGxpbmVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5oZWFkZXIucHVzaChsaW5lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBmb2xkZWQgaGVhZGVyIGxpbmVzIGFuZCBjYWxscyBDb250ZW50LVR5cGUgYW5kIFRyYW5zZmVyLUVuY29kaW5nIHByb2Nlc3NvcnNcbiAgICovXG4gIF9wYXJzZUhlYWRlcnMgKCkge1xuICAgIGZvciAobGV0IGhhc0JpbmFyeSA9IGZhbHNlLCBpID0gMCwgbGVuID0gdGhpcy5oZWFkZXIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGxldCB2YWx1ZSA9IHRoaXMuaGVhZGVyW2ldLnNwbGl0KCc6JylcbiAgICAgIGNvbnN0IGtleSA9ICh2YWx1ZS5zaGlmdCgpIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgdmFsdWUgPSAodmFsdWUuam9pbignOicpIHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJycpLnRyaW0oKVxuXG4gICAgICBpZiAodmFsdWUubWF0Y2goL1tcXHUwMDgwLVxcdUZGRkZdLykpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgICBoYXNCaW5hcnkgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgLy8gdXNlIGRlZmF1bHQgY2hhcnNldCBhdCBmaXJzdCBhbmQgaWYgdGhlIGFjdHVhbCBjaGFyc2V0IGlzIHJlc29sdmVkLCB0aGUgY29udmVyc2lvbiBpcyByZS1ydW5cbiAgICAgICAgdmFsdWUgPSBkZWNvZGUoY29udmVydChzdHIyYXJyKHZhbHVlKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJykpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuaGVhZGVyc1trZXldID0gKHRoaXMuaGVhZGVyc1trZXldIHx8IFtdKS5jb25jYXQoW3RoaXMuX3BhcnNlSGVhZGVyVmFsdWUoa2V5LCB2YWx1ZSldKVxuXG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiBrZXkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuaGVhZGVyc1trZXldW3RoaXMuaGVhZGVyc1trZXldLmxlbmd0aCAtIDFdLnBhcmFtcy5jaGFyc2V0XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXNCaW5hcnkgJiYgdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgIC8vIHJlc2V0IHZhbHVlcyBhbmQgc3RhcnQgb3ZlciBvbmNlIGNoYXJzZXQgaGFzIGJlZW4gcmVzb2x2ZWQgYW5kIDhiaXQgY29udGVudCBoYXMgYmVlbiBmb3VuZFxuICAgICAgICBoYXNCaW5hcnkgPSBmYWxzZVxuICAgICAgICB0aGlzLmhlYWRlcnMgPSB7fVxuICAgICAgICBpID0gLTEgLy8gbmV4dCBpdGVyYXRpb24gaGFzIGkgPT0gMFxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZmV0Y2hDb250ZW50VHlwZSgpXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgc2luZ2xlIGhlYWRlciB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEhlYWRlciBrZXlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlIFZhbHVlIGZvciB0aGUga2V5XG4gICAqIEByZXR1cm4ge09iamVjdH0gcGFyc2VkIGhlYWRlclxuICAgKi9cbiAgX3BhcnNlSGVhZGVyVmFsdWUgKGtleSwgdmFsdWUpIHtcbiAgICBsZXQgcGFyc2VkVmFsdWVcbiAgICBsZXQgaXNBZGRyZXNzID0gZmFsc2VcblxuICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICBjYXNlICdjb250ZW50LXR5cGUnOlxuICAgICAgY2FzZSAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZyc6XG4gICAgICBjYXNlICdjb250ZW50LWRpc3Bvc2l0aW9uJzpcbiAgICAgIGNhc2UgJ2RraW0tc2lnbmF0dXJlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZnJvbSc6XG4gICAgICBjYXNlICdzZW5kZXInOlxuICAgICAgY2FzZSAndG8nOlxuICAgICAgY2FzZSAncmVwbHktdG8nOlxuICAgICAgY2FzZSAnY2MnOlxuICAgICAgY2FzZSAnYmNjJzpcbiAgICAgIGNhc2UgJ2FidXNlLXJlcG9ydHMtdG8nOlxuICAgICAgY2FzZSAnZXJyb3JzLXRvJzpcbiAgICAgIGNhc2UgJ3JldHVybi1wYXRoJzpcbiAgICAgIGNhc2UgJ2RlbGl2ZXJlZC10byc6XG4gICAgICAgIGlzQWRkcmVzcyA9IHRydWVcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IFtdLmNvbmNhdChwYXJzZUFkZHJlc3ModmFsdWUpIHx8IFtdKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHRoaXMuX3BhcnNlRGF0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgIH1cbiAgICB9XG4gICAgcGFyc2VkVmFsdWUuaW5pdGlhbCA9IHZhbHVlXG5cbiAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHBhcnNlZFZhbHVlLCB7IGlzQWRkcmVzcyB9KVxuXG4gICAgcmV0dXJuIHBhcnNlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZGF0ZSBzdHJpbmcgY2FuIGJlIHBhcnNlZC4gRmFsbHMgYmFjayByZXBsYWNpbmcgdGltZXpvbmVcbiAgICogYWJicmV2YXRpb25zIHdpdGggdGltZXpvbmUgdmFsdWVzLiBCb2d1cyB0aW1lem9uZXMgZGVmYXVsdCB0byBVVEMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgRGF0ZSBoZWFkZXJcbiAgICogQHJldHVybnMge1N0cmluZ30gVVRDIGRhdGUgc3RyaW5nIGlmIHBhcnNpbmcgc3VjY2VlZGVkLCBvdGhlcndpc2UgcmV0dXJucyBpbnB1dCB2YWx1ZVxuICAgKi9cbiAgX3BhcnNlRGF0ZSAoc3RyID0gJycpIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyLnRyaW0oKS5yZXBsYWNlKC9cXGJbYS16XSskL2ksIHR6ID0+IHRpbWV6b25lW3R6LnRvVXBwZXJDYXNlKCldIHx8ICcrMDAwMCcpKVxuICAgIHJldHVybiAoZGF0ZS50b1N0cmluZygpICE9PSAnSW52YWxpZCBEYXRlJykgPyBkYXRlLnRvVVRDU3RyaW5nKCkucmVwbGFjZSgvR01ULywgJyswMDAwJykgOiBzdHJcbiAgfVxuXG4gIF9kZWNvZGVIZWFkZXJDaGFyc2V0IChwYXJzZWQsIHsgaXNBZGRyZXNzIH0gPSB7fSkge1xuICAgIC8vIGRlY29kZSBkZWZhdWx0IHZhbHVlXG4gICAgaWYgKHR5cGVvZiBwYXJzZWQudmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBwYXJzZWQudmFsdWUgPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnZhbHVlKVxuICAgIH1cblxuICAgIC8vIGRlY29kZSBwb3NzaWJsZSBwYXJhbXNcbiAgICBPYmplY3Qua2V5cyhwYXJzZWQucGFyYW1zIHx8IHt9KS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBhcmFtc1trZXldID09PSAnc3RyaW5nJykge1xuICAgICAgICBwYXJzZWQucGFyYW1zW2tleV0gPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnBhcmFtc1trZXldKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBkZWNvZGUgYWRkcmVzc2VzXG4gICAgaWYgKGlzQWRkcmVzcyAmJiBBcnJheS5pc0FycmF5KHBhcnNlZC52YWx1ZSkpIHtcbiAgICAgIHBhcnNlZC52YWx1ZS5mb3JFYWNoKGFkZHIgPT4ge1xuICAgICAgICBpZiAoYWRkci5uYW1lKSB7XG4gICAgICAgICAgYWRkci5uYW1lID0gbWltZVdvcmRzRGVjb2RlKGFkZHIubmFtZSlcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhZGRyLmdyb3VwKSkge1xuICAgICAgICAgICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldCh7IHZhbHVlOiBhZGRyLmdyb3VwIH0sIHsgaXNBZGRyZXNzOiB0cnVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UeXBlIHZhbHVlIGFuZCBzZWxlY3RzIGZvbGxvd2luZyBhY3Rpb25zLlxuICAgKi9cbiAgZmV0Y2hDb250ZW50VHlwZSAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgndGV4dC9wbGFpbicpXG4gICAgdGhpcy5jb250ZW50VHlwZSA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXR5cGUnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFR5cGUudmFsdWUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnNoaWZ0KCkgfHwgJ3RleHQnKVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUucGFyYW1zICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldFxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPT09ICdtdWx0aXBhcnQnICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5KSB7XG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXVxuICAgICAgdGhpcy5faXNNdWx0aXBhcnQgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnBvcCgpIHx8ICdtaXhlZCcpXG4gICAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRm9yIGF0dGFjaG1lbnQgKGlubGluZS9yZWd1bGFyKSBpZiBjaGFyc2V0IGlzIG5vdCBkZWZpbmVkIGFuZCBhdHRhY2htZW50IGlzIG5vbi10ZXh0LyosXG4gICAgICogdGhlbiBkZWZhdWx0IGNoYXJzZXQgdG8gYmluYXJ5LlxuICAgICAqIFJlZmVyIHRvIGlzc3VlOiBodHRwczovL2dpdGh1Yi5jb20vZW1haWxqcy9lbWFpbGpzLW1pbWUtcGFyc2VyL2lzc3Vlcy8xOFxuICAgICAqL1xuICAgIGNvbnN0IGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gcGF0aE9yKGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLCAnMCddKSh0aGlzKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnYXR0YWNobWVudCdcbiAgICBjb25zdCBpc0lubGluZUF0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2lubGluZSdcbiAgICBpZiAoKGlzQXR0YWNobWVudCB8fCBpc0lubGluZUF0dGFjaG1lbnQpICYmIHRoaXMuY29udGVudFR5cGUudHlwZSAhPT0gJ3RleHQnICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9ICdiaW5hcnknXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudmFsdWUgPT09ICdtZXNzYWdlL3JmYzgyMicgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBQYXJzZSBtZXNzYWdlL3JmYzgyMiBvbmx5IGlmIHRoZSBtaW1lIHBhcnQgaXMgbm90IG1hcmtlZCB3aXRoIGNvbnRlbnQtZGlzcG9zaXRpb246IGF0dGFjaG1lbnQsXG4gICAgICAgKiBvdGhlcndpc2UgdHJlYXQgaXQgbGlrZSBhIHJlZ3VsYXIgYXR0YWNobWVudFxuICAgICAgICovXG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcylcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFt0aGlzLl9jdXJyZW50Q2hpbGRdXG4gICAgICB0aGlzLl9pc1JmYzgyMiA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHJhbnNmZXItRW5jb2RpbmcgdmFsdWUgdG8gc2VlIGlmIHRoZSBib2R5IG5lZWRzIHRvIGJlIGNvbnZlcnRlZFxuICAgKiBiZWZvcmUgaXQgY2FuIGJlIGVtaXR0ZWRcbiAgICovXG4gIF9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJzdiaXQnKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZycsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9IHBhdGhPcignJywgWydjb250ZW50VHJhbnNmZXJFbmNvZGluZycsICd2YWx1ZSddKSh0aGlzKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEJPRFkgc3RhdGUuIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgcmZjODIyIG5vZGUsXG4gICAqIHBhc3NlcyBsaW5lIHZhbHVlIHRvIGNoaWxkIG5vZGVzLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICovXG4gIF9wcm9jZXNzQm9keUxpbmUgKGxpbmUpIHtcbiAgICBpZiAodGhpcy5faXNNdWx0aXBhcnQpIHtcbiAgICAgIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkpIHtcbiAgICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IGxpbmUgKyAnXFxuJ1xuICAgICAgICBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcylcbiAgICAgICAgdGhpcy5jaGlsZE5vZGVzLnB1c2godGhpcy5fY3VycmVudENoaWxkKVxuICAgICAgfSBlbHNlIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS0nKSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2VcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC53cml0ZUxpbmUobGluZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElnbm9yZSBtdWx0aXBhcnQgcHJlYW1ibGVcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2xpbmVDb3VudCsrXG5cbiAgICAgIHN3aXRjaCAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSkge1xuICAgICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gbGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJ3F1b3RlZC1wcmludGFibGUnOiB7XG4gICAgICAgICAgbGV0IGN1ckxpbmUgPSB0aGlzLl9saW5lUmVtYWluZGVyICsgKHRoaXMuX2xpbmVDb3VudCA+IDEgPyAnXFxuJyA6ICcnKSArIGxpbmVcbiAgICAgICAgICBjb25zdCBtYXRjaCA9IGN1ckxpbmUubWF0Y2goLz1bYS1mMC05XXswLDF9JC9pKVxuICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9IG1hdGNoWzBdXG4gICAgICAgICAgICBjdXJMaW5lID0gY3VyTGluZS5zdWJzdHIoMCwgY3VyTGluZS5sZW5ndGggLSB0aGlzLl9saW5lUmVtYWluZGVyLmxlbmd0aClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnXG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gY3VyTGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnN2JpdCc6XG4gICAgICAgIGNhc2UgJzhiaXQnOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gKHRoaXMuX2xpbmVDb3VudCA+IDEgPyAnXFxuJyA6ICcnKSArIGxpbmVcbiAgICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBhIGNodW5rIG9mIHRoZSBib2R5XG4gICovXG4gIF9lbWl0Qm9keSAoKSB7XG4gICAgdGhpcy5fZGVjb2RlQm9keUJ1ZmZlcigpXG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0IHx8ICF0aGlzLl9ib2R5QnVmZmVyKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9wcm9jZXNzRmxvd2VkVGV4dCgpXG4gICAgdGhpcy5jb250ZW50ID0gc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKVxuICAgIHRoaXMuX3Byb2Nlc3NIdG1sVGV4dCgpXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnXG4gIH1cblxuICBfcHJvY2Vzc0Zsb3dlZFRleHQgKCkge1xuICAgIGNvbnN0IGlzVGV4dCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNGbG93ZWQgPSAvXmZsb3dlZCQvaS50ZXN0KHBhdGhPcignJywgWydjb250ZW50VHlwZScsICdwYXJhbXMnLCAnZm9ybWF0J10pKHRoaXMpKVxuICAgIGlmICghaXNUZXh0IHx8ICFpc0Zsb3dlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWxTcCA9IC9eeWVzJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS5wYXJhbXMuZGVsc3ApXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9IHRoaXMuX2JvZHlCdWZmZXIuc3BsaXQoJ1xcbicpXG4gICAgICAucmVkdWNlKGZ1bmN0aW9uIChwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWUpIHtcbiAgICAgICAgLy8gcmVtb3ZlIHNvZnQgbGluZWJyZWFrcyBhZnRlciBzcGFjZSBzeW1ib2xzLlxuICAgICAgICAvLyBkZWxzcCBhZGRzIHNwYWNlcyB0byB0ZXh0IHRvIGJlIGFibGUgdG8gZm9sZCBpdC5cbiAgICAgICAgLy8gdGhlc2Ugc3BhY2VzIGNhbiBiZSByZW1vdmVkIG9uY2UgdGhlIHRleHQgaXMgdW5mb2xkZWRcbiAgICAgICAgY29uc3QgZW5kc1dpdGhTcGFjZSA9IC8gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICBjb25zdCBpc0JvdW5kYXJ5ID0gLyhefFxcbiktLSAkLy50ZXN0KHByZXZpb3VzVmFsdWUpXG4gICAgICAgIHJldHVybiAoZGVsU3AgPyBwcmV2aW91c1ZhbHVlLnJlcGxhY2UoL1sgXSskLywgJycpIDogcHJldmlvdXNWYWx1ZSkgKyAoKGVuZHNXaXRoU3BhY2UgJiYgIWlzQm91bmRhcnkpID8gJycgOiAnXFxuJykgKyBjdXJyZW50VmFsdWVcbiAgICAgIH0pXG4gICAgICAucmVwbGFjZSgvXiAvZ20sICcnKSAvLyByZW1vdmUgd2hpdGVzcGFjZSBzdHVmZmluZyBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNjc2I3NlY3Rpb24tNC40XG4gIH1cblxuICBfcHJvY2Vzc0h0bWxUZXh0ICgpIHtcbiAgICBjb25zdCBjb250ZW50RGlzcG9zaXRpb24gPSAodGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgdGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ11bMF0pIHx8IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgaXNIdG1sID0gL150ZXh0XFwvKHBsYWlufGh0bWwpJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSlcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAvXmF0dGFjaG1lbnQkL2kudGVzdChjb250ZW50RGlzcG9zaXRpb24udmFsdWUpXG4gICAgaWYgKGlzSHRtbCAmJiAhaXNBdHRhY2htZW50KSB7XG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiAvXnRleHRcXC9odG1sJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSkpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5kZXRlY3RIVE1MQ2hhcnNldCh0aGlzLl9ib2R5QnVmZmVyKVxuICAgICAgfVxuXG4gICAgICAvLyBkZWNvZGUgXCJiaW5hcnlcIiBzdHJpbmcgdG8gYW4gdW5pY29kZSBzdHJpbmdcbiAgICAgIGlmICghL151dGZbLV9dPzgkL2kudGVzdCh0aGlzLmNoYXJzZXQpKSB7XG4gICAgICAgIHRoaXMuY29udGVudCA9IGNvbnZlcnQoc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJylcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9PT0gJ2Jhc2U2NCcpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gdXRmOFN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gb3ZlcnJpZGUgY2hhcnNldCBmb3IgdGV4dCBub2Rlc1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldCA9ICd1dGYtOCdcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGV0ZWN0IGNoYXJzZXQgZnJvbSBhIGh0bWwgZmlsZVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaHRtbCBJbnB1dCBIVE1MXG4gICAqIEByZXR1cm5zIHtTdHJpbmd9IENoYXJzZXQgaWYgZm91bmQgb3IgdW5kZWZpbmVkXG4gICAqL1xuICBkZXRlY3RIVE1MQ2hhcnNldCAoaHRtbCkge1xuICAgIGxldCBjaGFyc2V0LCBpbnB1dFxuXG4gICAgaHRtbCA9IGh0bWwucmVwbGFjZSgvXFxyP1xcbnxcXHIvZywgJyAnKVxuICAgIGxldCBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMraHR0cC1lcXVpdj1bXCInXFxzXSpjb250ZW50LXR5cGVbXj5dKj8+L2kpXG4gICAgaWYgKG1ldGEpIHtcbiAgICAgIGlucHV0ID0gbWV0YVswXVxuICAgIH1cblxuICAgIGlmIChpbnB1dCkge1xuICAgICAgY2hhcnNldCA9IGlucHV0Lm1hdGNoKC9jaGFyc2V0XFxzPz1cXHM/KFthLXpBLVpcXC1fOjAtOV0qKTs/LylcbiAgICAgIGlmIChjaGFyc2V0KSB7XG4gICAgICAgIGNoYXJzZXQgPSAoY2hhcnNldFsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMrY2hhcnNldD1bXCInXFxzXSooW15cIic8Pi9cXHNdKykvaSlcbiAgICBpZiAoIWNoYXJzZXQgJiYgbWV0YSkge1xuICAgICAgY2hhcnNldCA9IChtZXRhWzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFyc2V0XG4gIH1cbn1cblxuY29uc3Qgc3RyMmFyciA9IHN0ciA9PiBuZXcgVWludDhBcnJheShzdHIuc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIuY2hhckNvZGVBdCgwKSkpXG5jb25zdCB1dGY4U3RyMmFyciA9IHN0ciA9PiBuZXcgVGV4dEVuY29kZXIoJ3V0Zi04JykuZW5jb2RlKHN0cilcbiJdfQ==
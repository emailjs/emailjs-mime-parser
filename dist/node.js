'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ramda = require('ramda');

var _timezones = require('./timezones');

var _timezones2 = _interopRequireDefault(_timezones);

var _emailjsMimeCodec = require('emailjs-mime-codec');

var _textEncoding = require('text-encoding');

var _emailjsAddressparser = require('emailjs-addressparser');

var _emailjsAddressparser2 = _interopRequireDefault(_emailjsAddressparser);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var MimeNode = function () {
  function MimeNode() {
    _classCallCheck(this, MimeNode);

    this.header = []; // An array of unfolded header lines
    this.headers = {}; // An object that holds header key=value pairs
    this.bodystructure = '';
    this.childNodes = []; // If this is a multipart or message/rfc822 mime part, the value will be converted to array and hold all child nodes for this node
    this.raw = ''; // Stores the raw content of this node

    this._state = 'HEADER'; // Current state, always starts out with HEADER
    this._bodyBuffer = ''; // Body buffer
    this._base64BodyBuffer = ''; // Body buffer in base64
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

      console.log(this._bodyBuffer);
    }
  }, {
    key: '_base64DecodeBodyBuffer',
    value: function _base64DecodeBodyBuffer() {
      if (this._base64BodyBuffer) {
        this._bodyBuffer = (0, _emailjsMimeCodec.base64Decode)(this._base64BodyBuffer, this.charset);
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

      this._processContentType();
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
    key: '_processContentType',
    value: function _processContentType() {
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
      this._lineCount++;

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
        switch (this.contentTransferEncoding.value) {
          case 'base64':
            {
              if (this.charset !== 'binary') {
                this._base64BodyBuffer += line;
                break;
              }

              var curLine = this._lineRemainder + line.trim();

              if (curLine.length % 4) {
                this._lineRemainder = curLine.substr(-curLine.length % 4);
                curLine = curLine.substr(0, curLine.length - this._lineRemainder.length);
              } else {
                this._lineRemainder = '';
              }

              if (curLine.length) {
                this._bodyBuffer += (0, _emailjsMimeCodec.base64Decode)(curLine, this.charset);
              }

              break;
            }
          case 'quoted-printable':
            {
              var _curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line;
              var match = _curLine.match(/=[a-f0-9]{0,1}$/i);
              if (match) {
                this._lineRemainder = match[0];
                _curLine = _curLine.substr(0, _curLine.length - this._lineRemainder.length);
              } else {
                this._lineRemainder = '';
              }

              this._bodyBuffer += _curLine.replace(/=(\r?\n|$)/g, '').replace(/=([a-f0-9]{2})/ig, function (m, code) {
                return String.fromCharCode(parseInt(code, 16));
              });
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
      this._base64DecodeBodyBuffer();
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
          this.charset = this._detectHTMLCharset(this._bodyBuffer);
        }

        // decode "binary" string to an unicode string
        if (!/^utf[-_]?8$/i.test(this.charset)) {
          this.content = (0, _emailjsMimeCodec.convert)(str2arr(this._bodyBuffer), this.charset || 'iso-8859-1');
        } else if (this.contentTransferEncoding && this.contentTransferEncoding.value === 'base64') {
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
    key: '_detectHTMLCharset',
    value: function _detectHTMLCharset(html) {
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

exports.default = MimeNode;


var str2arr = function str2arr(str) {
  return new Uint8Array(str.split('').map(function (char) {
    return char.charCodeAt(0);
  }));
};

var utf8Str2arr = function utf8Str2arr(str) {
  return new _textEncoding.TextEncoder('utf-8').encode(str);
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9ub2RlLmpzIl0sIm5hbWVzIjpbIk1pbWVOb2RlIiwiaGVhZGVyIiwiaGVhZGVycyIsImJvZHlzdHJ1Y3R1cmUiLCJjaGlsZE5vZGVzIiwicmF3IiwiX3N0YXRlIiwiX2JvZHlCdWZmZXIiLCJfYmFzZTY0Qm9keUJ1ZmZlciIsIl9saW5lQ291bnQiLCJfY3VycmVudENoaWxkIiwiX2xpbmVSZW1haW5kZXIiLCJfaXNNdWx0aXBhcnQiLCJfbXVsdGlwYXJ0Qm91bmRhcnkiLCJfaXNSZmM4MjIiLCJsaW5lIiwiX3Byb2Nlc3NIZWFkZXJMaW5lIiwiX3Byb2Nlc3NCb2R5TGluZSIsImZpbmFsaXplIiwiX2VtaXRCb2R5IiwicmVkdWNlIiwiYWdnIiwiY2hpbGQiLCJqb2luIiwiY29uc29sZSIsImxvZyIsImNoYXJzZXQiLCJfcGFyc2VIZWFkZXJzIiwibWF0Y2giLCJsZW5ndGgiLCJwdXNoIiwiaGFzQmluYXJ5IiwiaSIsImxlbiIsInZhbHVlIiwic3BsaXQiLCJrZXkiLCJzaGlmdCIsInRyaW0iLCJ0b0xvd2VyQ2FzZSIsInJlcGxhY2UiLCJzdHIyYXJyIiwiY29uY2F0IiwiX3BhcnNlSGVhZGVyVmFsdWUiLCJwYXJhbXMiLCJfcHJvY2Vzc0NvbnRlbnRUeXBlIiwiX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInBhcnNlZFZhbHVlIiwiaXNBZGRyZXNzIiwiX3BhcnNlRGF0ZSIsImluaXRpYWwiLCJfZGVjb2RlSGVhZGVyQ2hhcnNldCIsInN0ciIsImRhdGUiLCJEYXRlIiwidGltZXpvbmUiLCJ0eiIsInRvVXBwZXJDYXNlIiwidG9TdHJpbmciLCJ0b1VUQ1N0cmluZyIsInBhcnNlZCIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwiQXJyYXkiLCJpc0FycmF5IiwiYWRkciIsIm5hbWUiLCJncm91cCIsImRlZmF1bHRWYWx1ZSIsImNvbnRlbnRUeXBlIiwidHlwZSIsImJvdW5kYXJ5IiwicG9wIiwiZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlIiwiY29udGVudERpc3Bvc2l0aW9uIiwiaXNBdHRhY2htZW50IiwiaXNJbmxpbmVBdHRhY2htZW50IiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ3cml0ZUxpbmUiLCJjdXJMaW5lIiwic3Vic3RyIiwibSIsImNvZGUiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJwYXJzZUludCIsIl9iYXNlNjREZWNvZGVCb2R5QnVmZmVyIiwiX3Byb2Nlc3NGbG93ZWRUZXh0IiwiY29udGVudCIsIl9wcm9jZXNzSHRtbFRleHQiLCJpc1RleHQiLCJ0ZXN0IiwiaXNGbG93ZWQiLCJkZWxTcCIsImRlbHNwIiwicHJldmlvdXNWYWx1ZSIsImN1cnJlbnRWYWx1ZSIsImVuZHNXaXRoU3BhY2UiLCJpc0JvdW5kYXJ5IiwiaXNIdG1sIiwiX2RldGVjdEhUTUxDaGFyc2V0IiwidXRmOFN0cjJhcnIiLCJodG1sIiwiaW5wdXQiLCJtZXRhIiwiVWludDhBcnJheSIsIm1hcCIsImNoYXIiLCJjaGFyQ29kZUF0IiwiVGV4dEVuY29kZXIiLCJlbmNvZGUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7Ozs7Ozs7SUFFcUJBLFE7QUFDbkIsc0JBQWU7QUFBQTs7QUFDYixTQUFLQyxNQUFMLEdBQWMsRUFBZCxDQURhLENBQ0k7QUFDakIsU0FBS0MsT0FBTCxHQUFlLEVBQWYsQ0FGYSxDQUVLO0FBQ2xCLFNBQUtDLGFBQUwsR0FBcUIsRUFBckI7QUFDQSxTQUFLQyxVQUFMLEdBQWtCLEVBQWxCLENBSmEsQ0FJUTtBQUNyQixTQUFLQyxHQUFMLEdBQVcsRUFBWCxDQUxhLENBS0M7O0FBRWQsU0FBS0MsTUFBTCxHQUFjLFFBQWQsQ0FQYSxDQU9VO0FBQ3ZCLFNBQUtDLFdBQUwsR0FBbUIsRUFBbkIsQ0FSYSxDQVFTO0FBQ3RCLFNBQUtDLGlCQUFMLEdBQXlCLEVBQXpCLENBVGEsQ0FTZTtBQUM1QixTQUFLQyxVQUFMLEdBQWtCLENBQWxCLENBVmEsQ0FVTztB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YThFLGNBQWI7O0FBRUFELGFBQU9BLEtBQUsvRCxPQUFMLENBQWEsV0FBYixFQUEwQixHQUExQixDQUFQO0FBQ0EsVUFBSWlFLE9BQU9GLEtBQUszRSxLQUFMLENBQVcsZ0RBQVgsQ0FBWDtBQUNBLFVBQUk2RSxJQUFKLEVBQVU7QUFDUkQsZ0JBQVFDLEtBQUssQ0FBTCxDQUFSO0FBQ0Q7O0FBRUQsVUFBSUQsS0FBSixFQUFXO0FBQ1Q5RSxrQkFBVThFLE1BQU01RSxLQUFOLENBQVksb0NBQVosQ0FBVjtBQUNBLFlBQUlGLE9BQUosRUFBYTtBQUNYQSxvQkFBVSxDQUFDQSxRQUFRLENBQVIsS0FBYyxFQUFmLEVBQW1CWSxJQUFuQixHQUEwQkMsV0FBMUIsRUFBVjtBQUNEO0FBQ0Y7O0FBRURrRSxhQUFPRixLQUFLM0UsS0FBTCxDQUFXLHVDQUFYLENBQVA7QUFDQSxVQUFJLENBQUNGLE9BQUQsSUFBWStFLElBQWhCLEVBQXNCO0FBQ3BCL0Usa0JBQVUsQ0FBQytFLEtBQUssQ0FBTCxLQUFXLEVBQVosRUFBZ0JuRSxJQUFoQixHQUF1QkMsV0FBdkIsRUFBVjtBQUNEOztBQUVELGFBQU9iLE9BQVA7QUFDRDs7Ozs7O2tCQXRaa0IxQixROzs7QUF5WnJCLElBQU15QyxVQUFVLFNBQVZBLE9BQVU7QUFBQSxTQUFPLElBQUlpRSxVQUFKLENBQWV0RCxJQUFJakIsS0FBSixDQUFVLEVBQVYsRUFBY3dFLEdBQWQsQ0FBa0I7QUFBQSxXQUFRQyxLQUFLQyxVQUFMLENBQWdCLENBQWhCLENBQVI7QUFBQSxHQUFsQixDQUFmLENBQVA7QUFBQSxDQUFoQjs7QUFFQSxJQUFNUCxjQUFjLFNBQWRBLFdBQWM7QUFBQSxTQUFPLElBQUlRLHlCQUFKLENBQWdCLE9BQWhCLEVBQXlCQyxNQUF6QixDQUFnQzNELEdBQWhDLENBQVA7QUFBQSxDQUFwQiIsImZpbGUiOiJub2RlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcGF0aE9yIH0gZnJvbSAncmFtZGEnXG5pbXBvcnQgdGltZXpvbmUgZnJvbSAnLi90aW1lem9uZXMnXG5pbXBvcnQgeyBkZWNvZGUsIGJhc2U2NERlY29kZSwgY29udmVydCwgcGFyc2VIZWFkZXJWYWx1ZSwgbWltZVdvcmRzRGVjb2RlIH0gZnJvbSAnZW1haWxqcy1taW1lLWNvZGVjJ1xuaW1wb3J0IHsgVGV4dEVuY29kZXIgfSBmcm9tICd0ZXh0LWVuY29kaW5nJ1xuaW1wb3J0IHBhcnNlQWRkcmVzcyBmcm9tICdlbWFpbGpzLWFkZHJlc3NwYXJzZXInXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE1pbWVOb2RlIHtcbiAgY29uc3RydWN0b3IgKCkge1xuICAgIHRoaXMuaGVhZGVyID0gW10gLy8gQW4gYXJyYXkgb2YgdW5mb2xkZWQgaGVhZGVyIGxpbmVzXG4gICAgdGhpcy5oZWFkZXJzID0ge30gLy8gQW4gb2JqZWN0IHRoYXQgaG9sZHMgaGVhZGVyIGtleT12YWx1ZSBwYWlyc1xuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9ICcnXG4gICAgdGhpcy5jaGlsZE5vZGVzID0gW10gLy8gSWYgdGhpcyBpcyBhIG11bHRpcGFydCBvciBtZXNzYWdlL3JmYzgyMiBtaW1lIHBhcnQsIHRoZSB2YWx1ZSB3aWxsIGJlIGNvbnZlcnRlZCB0byBhcnJheSBhbmQgaG9sZCBhbGwgY2hpbGQgbm9kZXMgZm9yIHRoaXMgbm9kZVxuICAgIHRoaXMucmF3ID0gJycgLy8gU3RvcmVzIHRoZSByYXcgY29udGVudCBvZiB0aGlzIG5vZGVcblxuICAgIHRoaXMuX3N0YXRlID0gJ0hFQURFUicgLy8gQ3VycmVudCBzdGF0ZSwgYWx3YXlzIHN0YXJ0cyBvdXQgd2l0aCBIRUFERVJcbiAgICB0aGlzLl9ib2R5QnVmZmVyID0gJycgLy8gQm9keSBidWZmZXJcbiAgICB0aGlzLl9iYXNlNjRCb2R5QnVmZmVyID0gJycgLy8gQm9keSBidWZmZXIgaW4gYmFzZTY0XG4gICAgdGhpcy5fbGluZUNvdW50ID0gMCAvLyBMaW5lIGNvdW50ZXIgYm9yIHRoZSBib2R5IHBhcnRcbiAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBmYWxzZSAvLyBBY3RpdmUgY2hpbGQgbm9kZSAoaWYgYXZhaWxhYmxlKVxuICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJyAvLyBSZW1haW5kZXIgc3RyaW5nIHdoZW4gZGVhbGluZyB3aXRoIGJhc2U2NCBhbmQgcXAgdmFsdWVzXG4gICAgdGhpcy5faXNNdWx0aXBhcnQgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSBmYWxzZSAvLyBTdG9yZXMgYm91bmRhcnkgdmFsdWUgZm9yIGN1cnJlbnQgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9pc1JmYzgyMiA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbWVzc2FnZS9yZmM4MjIgbm9kZVxuICB9XG5cbiAgd3JpdGVMaW5lIChsaW5lKSB7XG4gICAgdGhpcy5yYXcgKz0gKHRoaXMucmF3ID8gJ1xcbicgOiAnJykgKyBsaW5lXG5cbiAgICBpZiAodGhpcy5fc3RhdGUgPT09ICdIRUFERVInKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzSGVhZGVyTGluZShsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5fc3RhdGUgPT09ICdCT0RZJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0JvZHlMaW5lKGxpbmUpXG4gICAgfVxuICB9XG5cbiAgZmluYWxpemUgKCkge1xuICAgIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZW1pdEJvZHkoKVxuICAgIH1cblxuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9IHRoaXMuY2hpbGROb2Rlc1xuICAgIC5yZWR1Y2UoKGFnZywgY2hpbGQpID0+IGFnZyArICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICdcXG4nICsgY2hpbGQuYm9keXN0cnVjdHVyZSwgdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJykgK1xuICAgICAgKHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID8gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJy0tXFxuJyA6ICcnKVxuXG4gICAgY29uc29sZS5sb2codGhpcy5fYm9keUJ1ZmZlcilcbiAgfVxuXG4gIF9iYXNlNjREZWNvZGVCb2R5QnVmZmVyICgpIHtcbiAgICBpZiAodGhpcy5fYmFzZTY0Qm9keUJ1ZmZlcikge1xuICAgICAgdGhpcy5fYm9keUJ1ZmZlciA9IGJhc2U2NERlY29kZSh0aGlzLl9iYXNlNjRCb2R5QnVmZmVyLCB0aGlzLmNoYXJzZXQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEhFQURFUiBzdGF0ZS4gSXQgdGhlIGxpbmUgaXMgZW1wdHksIGNoYW5nZSBzdGF0ZSB0byBCT0RZXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBsaW5lIEVudGlyZSBpbnB1dCBsaW5lIGFzICdiaW5hcnknIHN0cmluZ1xuICAgKi9cbiAgX3Byb2Nlc3NIZWFkZXJMaW5lIChsaW5lKSB7XG4gICAgaWYgKCFsaW5lKSB7XG4gICAgICB0aGlzLl9wYXJzZUhlYWRlcnMoKVxuICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbidcbiAgICAgIHRoaXMuX3N0YXRlID0gJ0JPRFknXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobGluZS5tYXRjaCgvXlxccy8pICYmIHRoaXMuaGVhZGVyLmxlbmd0aCkge1xuICAgICAgdGhpcy5oZWFkZXJbdGhpcy5oZWFkZXIubGVuZ3RoIC0gMV0gKz0gJ1xcbicgKyBsaW5lXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuaGVhZGVyLnB1c2gobGluZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSm9pbnMgZm9sZGVkIGhlYWRlciBsaW5lcyBhbmQgY2FsbHMgQ29udGVudC1UeXBlIGFuZCBUcmFuc2Zlci1FbmNvZGluZyBwcm9jZXNzb3JzXG4gICAqL1xuICBfcGFyc2VIZWFkZXJzICgpIHtcbiAgICBmb3IgKGxldCBoYXNCaW5hcnkgPSBmYWxzZSwgaSA9IDAsIGxlbiA9IHRoaXMuaGVhZGVyLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBsZXQgdmFsdWUgPSB0aGlzLmhlYWRlcltpXS5zcGxpdCgnOicpXG4gICAgICBjb25zdCBrZXkgPSAodmFsdWUuc2hpZnQoKSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIHZhbHVlID0gKHZhbHVlLmpvaW4oJzonKSB8fCAnJykucmVwbGFjZSgvXFxuL2csICcnKS50cmltKClcblxuICAgICAgaWYgKHZhbHVlLm1hdGNoKC9bXFx1MDA4MC1cXHVGRkZGXS8pKSB7XG4gICAgICAgIGlmICghdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgICAgaGFzQmluYXJ5ID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIC8vIHVzZSBkZWZhdWx0IGNoYXJzZXQgYXQgZmlyc3QgYW5kIGlmIHRoZSBhY3R1YWwgY2hhcnNldCBpcyByZXNvbHZlZCwgdGhlIGNvbnZlcnNpb24gaXMgcmUtcnVuXG4gICAgICAgIHZhbHVlID0gZGVjb2RlKGNvbnZlcnQoc3RyMmFycih2YWx1ZSksIHRoaXMuY2hhcnNldCB8fCAnaXNvLTg4NTktMScpKVxuICAgICAgfVxuXG4gICAgICB0aGlzLmhlYWRlcnNba2V5XSA9ICh0aGlzLmhlYWRlcnNba2V5XSB8fCBbXSkuY29uY2F0KFt0aGlzLl9wYXJzZUhlYWRlclZhbHVlKGtleSwgdmFsdWUpXSlcblxuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYga2V5ID09PSAnY29udGVudC10eXBlJykge1xuICAgICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmhlYWRlcnNba2V5XVt0aGlzLmhlYWRlcnNba2V5XS5sZW5ndGggLSAxXS5wYXJhbXMuY2hhcnNldFxuICAgICAgfVxuXG4gICAgICBpZiAoaGFzQmluYXJ5ICYmIHRoaXMuY2hhcnNldCkge1xuICAgICAgICAvLyByZXNldCB2YWx1ZXMgYW5kIHN0YXJ0IG92ZXIgb25jZSBjaGFyc2V0IGhhcyBiZWVuIHJlc29sdmVkIGFuZCA4Yml0IGNvbnRlbnQgaGFzIGJlZW4gZm91bmRcbiAgICAgICAgaGFzQmluYXJ5ID0gZmFsc2VcbiAgICAgICAgdGhpcy5oZWFkZXJzID0ge31cbiAgICAgICAgaSA9IC0xIC8vIG5leHQgaXRlcmF0aW9uIGhhcyBpID09IDBcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLl9wcm9jZXNzQ29udGVudFR5cGUoKVxuICAgIHRoaXMuX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZygpXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIHNpbmdsZSBoZWFkZXIgdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IGtleSBIZWFkZXIga2V5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSB2YWx1ZSBWYWx1ZSBmb3IgdGhlIGtleVxuICAgKiBAcmV0dXJuIHtPYmplY3R9IHBhcnNlZCBoZWFkZXJcbiAgICovXG4gIF9wYXJzZUhlYWRlclZhbHVlIChrZXksIHZhbHVlKSB7XG4gICAgbGV0IHBhcnNlZFZhbHVlXG4gICAgbGV0IGlzQWRkcmVzcyA9IGZhbHNlXG5cbiAgICBzd2l0Y2ggKGtleSkge1xuICAgICAgY2FzZSAnY29udGVudC10eXBlJzpcbiAgICAgIGNhc2UgJ2NvbnRlbnQtdHJhbnNmZXItZW5jb2RpbmcnOlxuICAgICAgY2FzZSAnY29udGVudC1kaXNwb3NpdGlvbic6XG4gICAgICBjYXNlICdka2ltLXNpZ25hdHVyZSc6XG4gICAgICAgIHBhcnNlZFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSh2YWx1ZSlcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2Zyb20nOlxuICAgICAgY2FzZSAnc2VuZGVyJzpcbiAgICAgIGNhc2UgJ3RvJzpcbiAgICAgIGNhc2UgJ3JlcGx5LXRvJzpcbiAgICAgIGNhc2UgJ2NjJzpcbiAgICAgIGNhc2UgJ2JjYyc6XG4gICAgICBjYXNlICdhYnVzZS1yZXBvcnRzLXRvJzpcbiAgICAgIGNhc2UgJ2Vycm9ycy10byc6XG4gICAgICBjYXNlICdyZXR1cm4tcGF0aCc6XG4gICAgICBjYXNlICdkZWxpdmVyZWQtdG8nOlxuICAgICAgICBpc0FkZHJlc3MgPSB0cnVlXG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiBbXS5jb25jYXQocGFyc2VBZGRyZXNzKHZhbHVlKSB8fCBbXSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiB0aGlzLl9wYXJzZURhdGUodmFsdWUpXG4gICAgICAgIH1cbiAgICAgICAgYnJlYWtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiB2YWx1ZVxuICAgICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFZhbHVlLmluaXRpYWwgPSB2YWx1ZVxuXG4gICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldChwYXJzZWRWYWx1ZSwgeyBpc0FkZHJlc3MgfSlcblxuICAgIHJldHVybiBwYXJzZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIGRhdGUgc3RyaW5nIGNhbiBiZSBwYXJzZWQuIEZhbGxzIGJhY2sgcmVwbGFjaW5nIHRpbWV6b25lXG4gICAqIGFiYnJldmF0aW9ucyB3aXRoIHRpbWV6b25lIHZhbHVlcy4gQm9ndXMgdGltZXpvbmVzIGRlZmF1bHQgdG8gVVRDLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gc3RyIERhdGUgaGVhZGVyXG4gICAqIEByZXR1cm5zIHtTdHJpbmd9IFVUQyBkYXRlIHN0cmluZyBpZiBwYXJzaW5nIHN1Y2NlZWRlZCwgb3RoZXJ3aXNlIHJldHVybnMgaW5wdXQgdmFsdWVcbiAgICovXG4gIF9wYXJzZURhdGUgKHN0ciA9ICcnKSB7XG4gICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHN0ci50cmltKCkucmVwbGFjZSgvXFxiW2Etel0rJC9pLCB0eiA9PiB0aW1lem9uZVt0ei50b1VwcGVyQ2FzZSgpXSB8fCAnKzAwMDAnKSlcbiAgICByZXR1cm4gKGRhdGUudG9TdHJpbmcoKSAhPT0gJ0ludmFsaWQgRGF0ZScpID8gZGF0ZS50b1VUQ1N0cmluZygpLnJlcGxhY2UoL0dNVC8sICcrMDAwMCcpIDogc3RyXG4gIH1cblxuICBfZGVjb2RlSGVhZGVyQ2hhcnNldCAocGFyc2VkLCB7IGlzQWRkcmVzcyB9ID0ge30pIHtcbiAgICAvLyBkZWNvZGUgZGVmYXVsdCB2YWx1ZVxuICAgIGlmICh0eXBlb2YgcGFyc2VkLnZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcGFyc2VkLnZhbHVlID0gbWltZVdvcmRzRGVjb2RlKHBhcnNlZC52YWx1ZSlcbiAgICB9XG5cbiAgICAvLyBkZWNvZGUgcG9zc2libGUgcGFyYW1zXG4gICAgT2JqZWN0LmtleXMocGFyc2VkLnBhcmFtcyB8fCB7fSkuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICBpZiAodHlwZW9mIHBhcnNlZC5wYXJhbXNba2V5XSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcGFyc2VkLnBhcmFtc1trZXldID0gbWltZVdvcmRzRGVjb2RlKHBhcnNlZC5wYXJhbXNba2V5XSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gZGVjb2RlIGFkZHJlc3Nlc1xuICAgIGlmIChpc0FkZHJlc3MgJiYgQXJyYXkuaXNBcnJheShwYXJzZWQudmFsdWUpKSB7XG4gICAgICBwYXJzZWQudmFsdWUuZm9yRWFjaChhZGRyID0+IHtcbiAgICAgICAgaWYgKGFkZHIubmFtZSkge1xuICAgICAgICAgIGFkZHIubmFtZSA9IG1pbWVXb3Jkc0RlY29kZShhZGRyLm5hbWUpXG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYWRkci5ncm91cCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2RlY29kZUhlYWRlckNoYXJzZXQoeyB2YWx1ZTogYWRkci5ncm91cCB9LCB7IGlzQWRkcmVzczogdHJ1ZSB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyc2VkXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHlwZSB2YWx1ZSBhbmQgc2VsZWN0cyBmb2xsb3dpbmcgYWN0aW9ucy5cbiAgICovXG4gIF9wcm9jZXNzQ29udGVudFR5cGUgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJ3RleHQvcGxhaW4nKVxuICAgIHRoaXMuY29udGVudFR5cGUgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10eXBlJywgJzAnXSkodGhpcylcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnZhbHVlID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpXG4gICAgdGhpcy5jb250ZW50VHlwZS50eXBlID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUuc3BsaXQoJy8nKS5zaGlmdCgpIHx8ICd0ZXh0JylcblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcyAmJiB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXRcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS50eXBlID09PSAnbXVsdGlwYXJ0JyAmJiB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5ib3VuZGFyeSkge1xuICAgICAgdGhpcy5jaGlsZE5vZGVzID0gW11cbiAgICAgIHRoaXMuX2lzTXVsdGlwYXJ0ID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUuc3BsaXQoJy8nKS5wb3AoKSB8fCAnbWl4ZWQnKVxuICAgICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5ib3VuZGFyeVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZvciBhdHRhY2htZW50IChpbmxpbmUvcmVndWxhcikgaWYgY2hhcnNldCBpcyBub3QgZGVmaW5lZCBhbmQgYXR0YWNobWVudCBpcyBub24tdGV4dC8qLFxuICAgICAqIHRoZW4gZGVmYXVsdCBjaGFyc2V0IHRvIGJpbmFyeS5cbiAgICAgKiBSZWZlciB0byBpc3N1ZTogaHR0cHM6Ly9naXRodWIuY29tL2VtYWlsanMvZW1haWxqcy1taW1lLXBhcnNlci9pc3N1ZXMvMThcbiAgICAgKi9cbiAgICBjb25zdCBkZWZhdWx0Q29udGVudERpc3Bvc2l0aW9uVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGNvbnRlbnREaXNwb3NpdGlvbiA9IHBhdGhPcihkZWZhdWx0Q29udGVudERpc3Bvc2l0aW9uVmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LWRpc3Bvc2l0aW9uJywgJzAnXSkodGhpcylcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2F0dGFjaG1lbnQnXG4gICAgY29uc3QgaXNJbmxpbmVBdHRhY2htZW50ID0gKGNvbnRlbnREaXNwb3NpdGlvbi52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKCkgPT09ICdpbmxpbmUnXG4gICAgaWYgKChpc0F0dGFjaG1lbnQgfHwgaXNJbmxpbmVBdHRhY2htZW50KSAmJiB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgIT09ICd0ZXh0JyAmJiAhdGhpcy5jaGFyc2V0KSB7XG4gICAgICB0aGlzLmNoYXJzZXQgPSAnYmluYXJ5J1xuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlID09PSAnbWVzc2FnZS9yZmM4MjInICYmICFpc0F0dGFjaG1lbnQpIHtcbiAgICAgIC8qKlxuICAgICAgICogUGFyc2UgbWVzc2FnZS9yZmM4MjIgb25seSBpZiB0aGUgbWltZSBwYXJ0IGlzIG5vdCBtYXJrZWQgd2l0aCBjb250ZW50LWRpc3Bvc2l0aW9uOiBhdHRhY2htZW50LFxuICAgICAgICogb3RoZXJ3aXNlIHRyZWF0IGl0IGxpa2UgYSByZWd1bGFyIGF0dGFjaG1lbnRcbiAgICAgICAqL1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMpXG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbdGhpcy5fY3VycmVudENoaWxkXVxuICAgICAgdGhpcy5faXNSZmM4MjIgPSB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nIHZhbHVlIHRvIHNlZSBpZiB0aGUgYm9keSBuZWVkcyB0byBiZSBjb252ZXJ0ZWRcbiAgICogYmVmb3JlIGl0IGNhbiBiZSBlbWl0dGVkXG4gICAqL1xuICBfcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nICgpIHtcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCc3Yml0JylcbiAgICB0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nID0gcGF0aE9yKGRlZmF1bHRWYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtdHJhbnNmZXItZW5jb2RpbmcnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUgPSBwYXRoT3IoJycsIFsnY29udGVudFRyYW5zZmVyRW5jb2RpbmcnLCAndmFsdWUnXSkodGhpcykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgYSBsaW5lIGluIHRoZSBCT0RZIHN0YXRlLiBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIHJmYzgyMiBub2RlLFxuICAgKiBwYXNzZXMgbGluZSB2YWx1ZSB0byBjaGlsZCBub2Rlcy5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0JvZHlMaW5lIChsaW5lKSB7XG4gICAgdGhpcy5fbGluZUNvdW50KytcblxuICAgIGlmICh0aGlzLl9pc011bHRpcGFydCkge1xuICAgICAgaWYgKGxpbmUgPT09ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSkge1xuICAgICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gbGluZSArICdcXG4nXG4gICAgICAgIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IG5ldyBNaW1lTm9kZSh0aGlzKVxuICAgICAgICB0aGlzLmNoaWxkTm9kZXMucHVzaCh0aGlzLl9jdXJyZW50Q2hpbGQpXG4gICAgICB9IGVsc2UgaWYgKGxpbmUgPT09ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICctLScpIHtcbiAgICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IGxpbmUgKyAnXFxuJ1xuICAgICAgICBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBmYWxzZVxuICAgICAgfSBlbHNlIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLndyaXRlTGluZShsaW5lKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gSWdub3JlIG11bHRpcGFydCBwcmVhbWJsZVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5faXNSZmM4MjIpIHtcbiAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC53cml0ZUxpbmUobGluZSlcbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoICh0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlKSB7XG4gICAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgICAge1xuICAgICAgICAgICAgaWYgKHRoaXMuY2hhcnNldCAhPT0gJ2JpbmFyeScpIHtcbiAgICAgICAgICAgICAgdGhpcy5fYmFzZTY0Qm9keUJ1ZmZlciArPSBsaW5lXG4gICAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBjdXJMaW5lID0gdGhpcy5fbGluZVJlbWFpbmRlciArIGxpbmUudHJpbSgpXG5cbiAgICAgICAgICAgIGlmIChjdXJMaW5lLmxlbmd0aCAlIDQpIHtcbiAgICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9IGN1ckxpbmUuc3Vic3RyKC1jdXJMaW5lLmxlbmd0aCAlIDQpXG4gICAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChjdXJMaW5lLmxlbmd0aCkge1xuICAgICAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGJhc2U2NERlY29kZShjdXJMaW5lLCB0aGlzLmNoYXJzZXQpXG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGJyZWFrXG4gICAgICAgICAgfVxuICAgICAgICBjYXNlICdxdW90ZWQtcHJpbnRhYmxlJzoge1xuICAgICAgICAgIGxldCBjdXJMaW5lID0gdGhpcy5fbGluZVJlbWFpbmRlciArICh0aGlzLl9saW5lQ291bnQgPiAxID8gJ1xcbicgOiAnJykgKyBsaW5lXG4gICAgICAgICAgY29uc3QgbWF0Y2ggPSBjdXJMaW5lLm1hdGNoKC89W2EtZjAtOV17MCwxfSQvaSlcbiAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSBtYXRjaFswXVxuICAgICAgICAgICAgY3VyTGluZSA9IGN1ckxpbmUuc3Vic3RyKDAsIGN1ckxpbmUubGVuZ3RoIC0gdGhpcy5fbGluZVJlbWFpbmRlci5sZW5ndGgpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJ1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gY3VyTGluZS5yZXBsYWNlKC89KFxccj9cXG58JCkvZywgJycpLnJlcGxhY2UoLz0oW2EtZjAtOV17Mn0pL2lnLCBmdW5jdGlvbiAobSwgY29kZSkge1xuICAgICAgICAgICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoY29kZSwgMTYpKVxuICAgICAgICAgIH0pXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgfVxuICAgICAgICBjYXNlICc3Yml0JzpcbiAgICAgICAgY2FzZSAnOGJpdCc6XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciArPSAodGhpcy5fbGluZUNvdW50ID4gMSA/ICdcXG4nIDogJycpICsgbGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGEgY2h1bmsgb2YgdGhlIGJvZHlcbiAgKi9cbiAgX2VtaXRCb2R5ICgpIHtcbiAgICB0aGlzLl9iYXNlNjREZWNvZGVCb2R5QnVmZmVyKClcbiAgICBpZiAodGhpcy5faXNNdWx0aXBhcnQgfHwgIXRoaXMuX2JvZHlCdWZmZXIpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRoaXMuX3Byb2Nlc3NGbG93ZWRUZXh0KClcbiAgICB0aGlzLmNvbnRlbnQgPSBzdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgdGhpcy5fcHJvY2Vzc0h0bWxUZXh0KClcbiAgICB0aGlzLl9ib2R5QnVmZmVyID0gJydcbiAgfVxuXG4gIF9wcm9jZXNzRmxvd2VkVGV4dCAoKSB7XG4gICAgY29uc3QgaXNUZXh0ID0gL150ZXh0XFwvKHBsYWlufGh0bWwpJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSlcbiAgICBjb25zdCBpc0Zsb3dlZCA9IC9eZmxvd2VkJC9pLnRlc3QocGF0aE9yKCcnLCBbJ2NvbnRlbnRUeXBlJywgJ3BhcmFtcycsICdmb3JtYXQnXSkodGhpcykpXG4gICAgaWYgKCFpc1RleHQgfHwgIWlzRmxvd2VkKSByZXR1cm5cblxuICAgIGNvbnN0IGRlbFNwID0gL155ZXMkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5kZWxzcClcbiAgICB0aGlzLl9ib2R5QnVmZmVyID0gdGhpcy5fYm9keUJ1ZmZlci5zcGxpdCgnXFxuJylcbiAgICAgIC5yZWR1Y2UoZnVuY3Rpb24gKHByZXZpb3VzVmFsdWUsIGN1cnJlbnRWYWx1ZSkge1xuICAgICAgICAvLyByZW1vdmUgc29mdCBsaW5lYnJlYWtzIGFmdGVyIHNwYWNlIHN5bWJvbHMuXG4gICAgICAgIC8vIGRlbHNwIGFkZHMgc3BhY2VzIHRvIHRleHQgdG8gYmUgYWJsZSB0byBmb2xkIGl0LlxuICAgICAgICAvLyB0aGVzZSBzcGFjZXMgY2FuIGJlIHJlbW92ZWQgb25jZSB0aGUgdGV4dCBpcyB1bmZvbGRlZFxuICAgICAgICBjb25zdCBlbmRzV2l0aFNwYWNlID0gLyAkLy50ZXN0KHByZXZpb3VzVmFsdWUpXG4gICAgICAgIGNvbnN0IGlzQm91bmRhcnkgPSAvKF58XFxuKS0tICQvLnRlc3QocHJldmlvdXNWYWx1ZSlcbiAgICAgICAgcmV0dXJuIChkZWxTcCA/IHByZXZpb3VzVmFsdWUucmVwbGFjZSgvWyBdKyQvLCAnJykgOiBwcmV2aW91c1ZhbHVlKSArICgoZW5kc1dpdGhTcGFjZSAmJiAhaXNCb3VuZGFyeSkgPyAnJyA6ICdcXG4nKSArIGN1cnJlbnRWYWx1ZVxuICAgICAgfSlcbiAgICAgIC5yZXBsYWNlKC9eIC9nbSwgJycpIC8vIHJlbW92ZSB3aGl0ZXNwYWNlIHN0dWZmaW5nIGh0dHA6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM2NzYjc2VjdGlvbi00LjRcbiAgfVxuXG4gIF9wcm9jZXNzSHRtbFRleHQgKCkge1xuICAgIGNvbnN0IGNvbnRlbnREaXNwb3NpdGlvbiA9ICh0aGlzLmhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXSAmJiB0aGlzLmhlYWRlcnNbJ2NvbnRlbnQtZGlzcG9zaXRpb24nXVswXSkgfHwgcGFyc2VIZWFkZXJWYWx1ZSgnJylcbiAgICBjb25zdCBpc0h0bWwgPSAvXnRleHRcXC8ocGxhaW58aHRtbCkkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IC9eYXR0YWNobWVudCQvaS50ZXN0KGNvbnRlbnREaXNwb3NpdGlvbi52YWx1ZSlcbiAgICBpZiAoaXNIdG1sICYmICFpc0F0dGFjaG1lbnQpIHtcbiAgICAgIGlmICghdGhpcy5jaGFyc2V0ICYmIC9edGV4dFxcL2h0bWwkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKSkge1xuICAgICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLl9kZXRlY3RIVE1MQ2hhcnNldCh0aGlzLl9ib2R5QnVmZmVyKVxuICAgICAgfVxuXG4gICAgICAvLyBkZWNvZGUgXCJiaW5hcnlcIiBzdHJpbmcgdG8gYW4gdW5pY29kZSBzdHJpbmdcbiAgICAgIGlmICghL151dGZbLV9dPzgkL2kudGVzdCh0aGlzLmNoYXJzZXQpKSB7XG4gICAgICAgIHRoaXMuY29udGVudCA9IGNvbnZlcnQoc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJylcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZyAmJiB0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlID09PSAnYmFzZTY0Jykge1xuICAgICAgICB0aGlzLmNvbnRlbnQgPSB1dGY4U3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKVxuICAgICAgfVxuXG4gICAgICAvLyBvdmVycmlkZSBjaGFyc2V0IGZvciB0ZXh0IG5vZGVzXG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ID0gJ3V0Zi04J1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlY3QgY2hhcnNldCBmcm9tIGEgaHRtbCBmaWxlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBodG1sIElucHV0IEhUTUxcbiAgICogQHJldHVybnMge1N0cmluZ30gQ2hhcnNldCBpZiBmb3VuZCBvciB1bmRlZmluZWRcbiAgICovXG4gIF9kZXRlY3RIVE1MQ2hhcnNldCAoaHRtbCkge1xuICAgIGxldCBjaGFyc2V0LCBpbnB1dFxuXG4gICAgaHRtbCA9IGh0bWwucmVwbGFjZSgvXFxyP1xcbnxcXHIvZywgJyAnKVxuICAgIGxldCBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMraHR0cC1lcXVpdj1bXCInXFxzXSpjb250ZW50LXR5cGVbXj5dKj8+L2kpXG4gICAgaWYgKG1ldGEpIHtcbiAgICAgIGlucHV0ID0gbWV0YVswXVxuICAgIH1cblxuICAgIGlmIChpbnB1dCkge1xuICAgICAgY2hhcnNldCA9IGlucHV0Lm1hdGNoKC9jaGFyc2V0XFxzPz1cXHM/KFthLXpBLVpcXC1fOjAtOV0qKTs/LylcbiAgICAgIGlmIChjaGFyc2V0KSB7XG4gICAgICAgIGNoYXJzZXQgPSAoY2hhcnNldFsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMrY2hhcnNldD1bXCInXFxzXSooW15cIic8Pi9cXHNdKykvaSlcbiAgICBpZiAoIWNoYXJzZXQgJiYgbWV0YSkge1xuICAgICAgY2hhcnNldCA9IChtZXRhWzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFyc2V0XG4gIH1cbn1cblxuY29uc3Qgc3RyMmFyciA9IHN0ciA9PiBuZXcgVWludDhBcnJheShzdHIuc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIuY2hhckNvZGVBdCgwKSkpXG5cbmNvbnN0IHV0ZjhTdHIyYXJyID0gc3RyID0+IG5ldyBUZXh0RW5jb2RlcigndXRmLTgnKS5lbmNvZGUoc3RyKVxuIl19
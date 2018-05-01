'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ramda = require('ramda');

var _timezones = require('./timezones');

var _timezones2 = _interopRequireDefault(_timezones);

var _emailjsMimeCodec = require('emailjs-mime-codec');

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
          case 'quoted-printable':
            curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line;
            var match = curLine.match(/=[a-f0-9]{0,1}$/i);
            if (match) {
              this._lineRemainder = match[0];
              curLine = curLine.substr(0, curLine.length - this._lineRemainder.length);
            } else {
              this._lineRemainder = '';
            }

            this._bodyBuffer += curLine.replace(/=(\r?\n|$)/g, '').replace(/=([a-f0-9]{2})/ig, function (m, code) {
              return String.fromCharCode(parseInt(code, 16));
            });
            break;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9ub2RlLmpzIl0sIm5hbWVzIjpbIk1pbWVOb2RlIiwiaGVhZGVyIiwiaGVhZGVycyIsImJvZHlzdHJ1Y3R1cmUiLCJjaGlsZE5vZGVzIiwicmF3IiwiX3N0YXRlIiwiX2JvZHlCdWZmZXIiLCJfbGluZUNvdW50IiwiX2N1cnJlbnRDaGlsZCIsIl9saW5lUmVtYWluZGVyIiwiX2lzTXVsdGlwYXJ0IiwiX211bHRpcGFydEJvdW5kYXJ5IiwiX2lzUmZjODIyIiwibGluZSIsIl9wcm9jZXNzSGVhZGVyTGluZSIsIl9wcm9jZXNzQm9keUxpbmUiLCJmaW5hbGl6ZSIsIl9lbWl0Qm9keSIsInJlZHVjZSIsImFnZyIsImNoaWxkIiwiam9pbiIsIl9wYXJzZUhlYWRlcnMiLCJtYXRjaCIsImxlbmd0aCIsInB1c2giLCJoYXNCaW5hcnkiLCJpIiwibGVuIiwidmFsdWUiLCJzcGxpdCIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwicmVwbGFjZSIsImNoYXJzZXQiLCJzdHIyYXJyIiwiY29uY2F0IiwiX3BhcnNlSGVhZGVyVmFsdWUiLCJwYXJhbXMiLCJfcHJvY2Vzc0NvbnRlbnRUeXBlIiwiX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInBhcnNlZFZhbHVlIiwiaXNBZGRyZXNzIiwiX3BhcnNlRGF0ZSIsImluaXRpYWwiLCJfZGVjb2RlSGVhZGVyQ2hhcnNldCIsInN0ciIsImRhdGUiLCJEYXRlIiwidGltZXpvbmUiLCJ0eiIsInRvVXBwZXJDYXNlIiwidG9TdHJpbmciLCJ0b1VUQ1N0cmluZyIsInBhcnNlZCIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwiQXJyYXkiLCJpc0FycmF5IiwiYWRkciIsIm5hbWUiLCJncm91cCIsImRlZmF1bHRWYWx1ZSIsImNvbnRlbnRUeXBlIiwidHlwZSIsImJvdW5kYXJ5IiwicG9wIiwiZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlIiwiY29udGVudERpc3Bvc2l0aW9uIiwiaXNBdHRhY2htZW50IiwiaXNJbmxpbmVBdHRhY2htZW50IiwiY29udGVudFRyYW5zZmVyRW5jb2RpbmciLCJ3cml0ZUxpbmUiLCJjdXJMaW5lIiwic3Vic3RyIiwibSIsImNvZGUiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJwYXJzZUludCIsIl9wcm9jZXNzRmxvd2VkVGV4dCIsImNvbnRlbnQiLCJfcHJvY2Vzc0h0bWxUZXh0IiwiaXNUZXh0IiwidGVzdCIsImlzRmxvd2VkIiwiZGVsU3AiLCJkZWxzcCIsInByZXZpb3VzVmFsdWUiLCJjdXJyZW50VmFsdWUiLCJlbmRzV2l0aFNwYWNlIiwiaXNCb3VuZGFyeSIsImlzSHRtbCIsIl9kZXRlY3RIVE1MQ2hhcnNldCIsImh0bWwiLCJpbnB1dCIsIm1ldGEiLCJVaW50OEFycmF5IiwibWFwIiwiY2hhciIsImNoYXJDb2RlQXQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUE7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7Ozs7Ozs7SUFFcUJBLFE7QUFDbkIsc0JBQWU7QUFBQTs7QUFDYixTQUFLQyxNQUFMLEdBQWMsRUFBZCxDQURhLENBQ0k7QUFDakIsU0FBS0MsT0FBTCxHQUFlLEVBQWYsQ0FGYSxDQUVLO0FBQ2xCLFNBQUtDLGFBQUwsR0FBcUIsRUFBckI7QUFDQSxTQUFLQyxVQUFMLEdBQWtCLEVBQWxCLENBSmEsQ0FJUTtBQUNyQixTQUFLQyxHQUFMLEdBQVcsRUFBWCxDQUxhLENBS0M7O0FBRWQsU0FBS0MsTUFBTCxHQUFjLFFBQWQsQ0FQYSxDQU9VO0FBQ3ZCLFNBQUtDLFdBQUwsR0FBbUIsRUFBbkIsQ0FSYSxDQVFTO0FBQ3RCLFNBQUtDLFVBQUwsR0FBa0IsQ0FBbEIsQ0FUYSxDQVNPO0FBQ3BCLFNBQUtDLGFBQUwsR0FBcUIsS0FBckIsQ0FWYSxDQVVjO0FBQzNCLFNBQUtDLGNBQUwsR0FBc0IsRUFBdEIsQ0FYYSxDQVdZO0FBQ3pCLFNBQUtDLFlBQUwsR0FBb0IsS0FBcEIsQ0FaYSxDQVlhO0FBQzFCLFNBQUtDLGtCQUFMLEdBQTBCLEtBQTFC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SStELFVBQUosQ0FBZXBELElBQUlsQixLQUFKLENBQVUsRUFBVixFQUFjdUUsR0FBZCxDQUFrQjtBQUFBLFdBQVFDLEtBQUtDLFVBQUwsQ0FBZ0IsQ0FBaEIsQ0FBUjtBQUFBLEdBQWxCLENBQWYsQ0FBUDtBQUFBLENBQWhCIiwiZmlsZSI6Im5vZGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBwYXRoT3IgfSBmcm9tICdyYW1kYSdcbmltcG9ydCB0aW1lem9uZSBmcm9tICcuL3RpbWV6b25lcydcbmltcG9ydCB7IGRlY29kZSwgYmFzZTY0RGVjb2RlLCBjb252ZXJ0LCBwYXJzZUhlYWRlclZhbHVlLCBtaW1lV29yZHNEZWNvZGUgfSBmcm9tICdlbWFpbGpzLW1pbWUtY29kZWMnXG5pbXBvcnQgcGFyc2VBZGRyZXNzIGZyb20gJ2VtYWlsanMtYWRkcmVzc3BhcnNlcidcblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgTWltZU5vZGUge1xuICBjb25zdHJ1Y3RvciAoKSB7XG4gICAgdGhpcy5oZWFkZXIgPSBbXSAvLyBBbiBhcnJheSBvZiB1bmZvbGRlZCBoZWFkZXIgbGluZXNcbiAgICB0aGlzLmhlYWRlcnMgPSB7fSAvLyBBbiBvYmplY3QgdGhhdCBob2xkcyBoZWFkZXIga2V5PXZhbHVlIHBhaXJzXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gJydcbiAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXSAvLyBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIG1lc3NhZ2UvcmZjODIyIG1pbWUgcGFydCwgdGhlIHZhbHVlIHdpbGwgYmUgY29udmVydGVkIHRvIGFycmF5IGFuZCBob2xkIGFsbCBjaGlsZCBub2RlcyBmb3IgdGhpcyBub2RlXG4gICAgdGhpcy5yYXcgPSAnJyAvLyBTdG9yZXMgdGhlIHJhdyBjb250ZW50IG9mIHRoaXMgbm9kZVxuXG4gICAgdGhpcy5fc3RhdGUgPSAnSEVBREVSJyAvLyBDdXJyZW50IHN0YXRlLCBhbHdheXMgc3RhcnRzIG91dCB3aXRoIEhFQURFUlxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJyAvLyBCb2R5IGJ1ZmZlclxuICAgIHRoaXMuX2xpbmVDb3VudCA9IDAgLy8gTGluZSBjb3VudGVyIGJvciB0aGUgYm9keSBwYXJ0XG4gICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2UgLy8gQWN0aXZlIGNoaWxkIG5vZGUgKGlmIGF2YWlsYWJsZSlcbiAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJycgLy8gUmVtYWluZGVyIHN0cmluZyB3aGVuIGRlYWxpbmcgd2l0aCBiYXNlNjQgYW5kIHFwIHZhbHVlc1xuICAgIHRoaXMuX2lzTXVsdGlwYXJ0ID0gZmFsc2UgLy8gSW5kaWNhdGVzIGlmIHRoaXMgaXMgYSBtdWx0aXBhcnQgbm9kZVxuICAgIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID0gZmFsc2UgLy8gU3RvcmVzIGJvdW5kYXJ5IHZhbHVlIGZvciBjdXJyZW50IG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5faXNSZmM4MjIgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG1lc3NhZ2UvcmZjODIyIG5vZGVcbiAgfVxuXG4gIHdyaXRlTGluZSAobGluZSkge1xuICAgIHRoaXMucmF3ICs9ICh0aGlzLnJhdyA/ICdcXG4nIDogJycpICsgbGluZVxuXG4gICAgaWYgKHRoaXMuX3N0YXRlID09PSAnSEVBREVSJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0hlYWRlckxpbmUobGluZSlcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3N0YXRlID09PSAnQk9EWScpIHtcbiAgICAgIHRoaXMuX3Byb2Nlc3NCb2R5TGluZShsaW5lKVxuICAgIH1cbiAgfVxuXG4gIGZpbmFsaXplICgpIHtcbiAgICBpZiAodGhpcy5faXNSZmM4MjIpIHtcbiAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2VtaXRCb2R5KClcbiAgICB9XG5cbiAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgPSB0aGlzLmNoaWxkTm9kZXNcbiAgICAucmVkdWNlKChhZ2csIGNoaWxkKSA9PiBhZ2cgKyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnXFxuJyArIGNoaWxkLmJvZHlzdHJ1Y3R1cmUsIHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbicpICtcbiAgICAodGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS1cXG4nIDogJycpXG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgSEVBREVSIHN0YXRlLiBJdCB0aGUgbGluZSBpcyBlbXB0eSwgY2hhbmdlIHN0YXRlIHRvIEJPRFlcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0hlYWRlckxpbmUgKGxpbmUpIHtcbiAgICBpZiAoIWxpbmUpIHtcbiAgICAgIHRoaXMuX3BhcnNlSGVhZGVycygpXG4gICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJ1xuICAgICAgdGhpcy5fc3RhdGUgPSAnQk9EWSdcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChsaW5lLm1hdGNoKC9eXFxzLykgJiYgdGhpcy5oZWFkZXIubGVuZ3RoKSB7XG4gICAgICB0aGlzLmhlYWRlclt0aGlzLmhlYWRlci5sZW5ndGggLSAxXSArPSAnXFxuJyArIGxpbmVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5oZWFkZXIucHVzaChsaW5lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBmb2xkZWQgaGVhZGVyIGxpbmVzIGFuZCBjYWxscyBDb250ZW50LVR5cGUgYW5kIFRyYW5zZmVyLUVuY29kaW5nIHByb2Nlc3NvcnNcbiAgICovXG4gIF9wYXJzZUhlYWRlcnMgKCkge1xuICAgIGZvciAobGV0IGhhc0JpbmFyeSA9IGZhbHNlLCBpID0gMCwgbGVuID0gdGhpcy5oZWFkZXIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGxldCB2YWx1ZSA9IHRoaXMuaGVhZGVyW2ldLnNwbGl0KCc6JylcbiAgICAgIGNvbnN0IGtleSA9ICh2YWx1ZS5zaGlmdCgpIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgdmFsdWUgPSAodmFsdWUuam9pbignOicpIHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJycpLnRyaW0oKVxuXG4gICAgICBpZiAodmFsdWUubWF0Y2goL1tcXHUwMDgwLVxcdUZGRkZdLykpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgICBoYXNCaW5hcnkgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgLy8gdXNlIGRlZmF1bHQgY2hhcnNldCBhdCBmaXJzdCBhbmQgaWYgdGhlIGFjdHVhbCBjaGFyc2V0IGlzIHJlc29sdmVkLCB0aGUgY29udmVyc2lvbiBpcyByZS1ydW5cbiAgICAgICAgdmFsdWUgPSBkZWNvZGUoY29udmVydChzdHIyYXJyKHZhbHVlKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJykpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuaGVhZGVyc1trZXldID0gKHRoaXMuaGVhZGVyc1trZXldIHx8IFtdKS5jb25jYXQoW3RoaXMuX3BhcnNlSGVhZGVyVmFsdWUoa2V5LCB2YWx1ZSldKVxuXG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiBrZXkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuaGVhZGVyc1trZXldW3RoaXMuaGVhZGVyc1trZXldLmxlbmd0aCAtIDFdLnBhcmFtcy5jaGFyc2V0XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXNCaW5hcnkgJiYgdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgIC8vIHJlc2V0IHZhbHVlcyBhbmQgc3RhcnQgb3ZlciBvbmNlIGNoYXJzZXQgaGFzIGJlZW4gcmVzb2x2ZWQgYW5kIDhiaXQgY29udGVudCBoYXMgYmVlbiBmb3VuZFxuICAgICAgICBoYXNCaW5hcnkgPSBmYWxzZVxuICAgICAgICB0aGlzLmhlYWRlcnMgPSB7fVxuICAgICAgICBpID0gLTEgLy8gbmV4dCBpdGVyYXRpb24gaGFzIGkgPT0gMFxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuX3Byb2Nlc3NDb250ZW50VHlwZSgpXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgc2luZ2xlIGhlYWRlciB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEhlYWRlciBrZXlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlIFZhbHVlIGZvciB0aGUga2V5XG4gICAqIEByZXR1cm4ge09iamVjdH0gcGFyc2VkIGhlYWRlclxuICAgKi9cbiAgX3BhcnNlSGVhZGVyVmFsdWUgKGtleSwgdmFsdWUpIHtcbiAgICBsZXQgcGFyc2VkVmFsdWVcbiAgICBsZXQgaXNBZGRyZXNzID0gZmFsc2VcblxuICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICBjYXNlICdjb250ZW50LXR5cGUnOlxuICAgICAgY2FzZSAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZyc6XG4gICAgICBjYXNlICdjb250ZW50LWRpc3Bvc2l0aW9uJzpcbiAgICAgIGNhc2UgJ2RraW0tc2lnbmF0dXJlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZnJvbSc6XG4gICAgICBjYXNlICdzZW5kZXInOlxuICAgICAgY2FzZSAndG8nOlxuICAgICAgY2FzZSAncmVwbHktdG8nOlxuICAgICAgY2FzZSAnY2MnOlxuICAgICAgY2FzZSAnYmNjJzpcbiAgICAgIGNhc2UgJ2FidXNlLXJlcG9ydHMtdG8nOlxuICAgICAgY2FzZSAnZXJyb3JzLXRvJzpcbiAgICAgIGNhc2UgJ3JldHVybi1wYXRoJzpcbiAgICAgIGNhc2UgJ2RlbGl2ZXJlZC10byc6XG4gICAgICAgIGlzQWRkcmVzcyA9IHRydWVcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IFtdLmNvbmNhdChwYXJzZUFkZHJlc3ModmFsdWUpIHx8IFtdKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHRoaXMuX3BhcnNlRGF0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgIH1cbiAgICB9XG4gICAgcGFyc2VkVmFsdWUuaW5pdGlhbCA9IHZhbHVlXG5cbiAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHBhcnNlZFZhbHVlLCB7IGlzQWRkcmVzcyB9KVxuXG4gICAgcmV0dXJuIHBhcnNlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZGF0ZSBzdHJpbmcgY2FuIGJlIHBhcnNlZC4gRmFsbHMgYmFjayByZXBsYWNpbmcgdGltZXpvbmVcbiAgICogYWJicmV2YXRpb25zIHdpdGggdGltZXpvbmUgdmFsdWVzLiBCb2d1cyB0aW1lem9uZXMgZGVmYXVsdCB0byBVVEMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgRGF0ZSBoZWFkZXJcbiAgICogQHJldHVybnMge1N0cmluZ30gVVRDIGRhdGUgc3RyaW5nIGlmIHBhcnNpbmcgc3VjY2VlZGVkLCBvdGhlcndpc2UgcmV0dXJucyBpbnB1dCB2YWx1ZVxuICAgKi9cbiAgX3BhcnNlRGF0ZSAoc3RyID0gJycpIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyLnRyaW0oKS5yZXBsYWNlKC9cXGJbYS16XSskL2ksIHR6ID0+IHRpbWV6b25lW3R6LnRvVXBwZXJDYXNlKCldIHx8ICcrMDAwMCcpKVxuICAgIHJldHVybiAoZGF0ZS50b1N0cmluZygpICE9PSAnSW52YWxpZCBEYXRlJykgPyBkYXRlLnRvVVRDU3RyaW5nKCkucmVwbGFjZSgvR01ULywgJyswMDAwJykgOiBzdHJcbiAgfVxuXG4gIF9kZWNvZGVIZWFkZXJDaGFyc2V0IChwYXJzZWQsIHsgaXNBZGRyZXNzIH0gPSB7fSkge1xuICAgIC8vIGRlY29kZSBkZWZhdWx0IHZhbHVlXG4gICAgaWYgKHR5cGVvZiBwYXJzZWQudmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBwYXJzZWQudmFsdWUgPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnZhbHVlKVxuICAgIH1cblxuICAgIC8vIGRlY29kZSBwb3NzaWJsZSBwYXJhbXNcbiAgICBPYmplY3Qua2V5cyhwYXJzZWQucGFyYW1zIHx8IHt9KS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBhcmFtc1trZXldID09PSAnc3RyaW5nJykge1xuICAgICAgICBwYXJzZWQucGFyYW1zW2tleV0gPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnBhcmFtc1trZXldKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBkZWNvZGUgYWRkcmVzc2VzXG4gICAgaWYgKGlzQWRkcmVzcyAmJiBBcnJheS5pc0FycmF5KHBhcnNlZC52YWx1ZSkpIHtcbiAgICAgIHBhcnNlZC52YWx1ZS5mb3JFYWNoKGFkZHIgPT4ge1xuICAgICAgICBpZiAoYWRkci5uYW1lKSB7XG4gICAgICAgICAgYWRkci5uYW1lID0gbWltZVdvcmRzRGVjb2RlKGFkZHIubmFtZSlcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhZGRyLmdyb3VwKSkge1xuICAgICAgICAgICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldCh7IHZhbHVlOiBhZGRyLmdyb3VwIH0sIHsgaXNBZGRyZXNzOiB0cnVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UeXBlIHZhbHVlIGFuZCBzZWxlY3RzIGZvbGxvd2luZyBhY3Rpb25zLlxuICAgKi9cbiAgX3Byb2Nlc3NDb250ZW50VHlwZSAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgndGV4dC9wbGFpbicpXG4gICAgdGhpcy5jb250ZW50VHlwZSA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXR5cGUnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFR5cGUudmFsdWUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnNoaWZ0KCkgfHwgJ3RleHQnKVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUucGFyYW1zICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldFxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPT09ICdtdWx0aXBhcnQnICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5KSB7XG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXVxuICAgICAgdGhpcy5faXNNdWx0aXBhcnQgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnBvcCgpIHx8ICdtaXhlZCcpXG4gICAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRm9yIGF0dGFjaG1lbnQgKGlubGluZS9yZWd1bGFyKSBpZiBjaGFyc2V0IGlzIG5vdCBkZWZpbmVkIGFuZCBhdHRhY2htZW50IGlzIG5vbi10ZXh0LyosXG4gICAgICogdGhlbiBkZWZhdWx0IGNoYXJzZXQgdG8gYmluYXJ5LlxuICAgICAqIFJlZmVyIHRvIGlzc3VlOiBodHRwczovL2dpdGh1Yi5jb20vZW1haWxqcy9lbWFpbGpzLW1pbWUtcGFyc2VyL2lzc3Vlcy8xOFxuICAgICAqL1xuICAgIGNvbnN0IGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gcGF0aE9yKGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLCAnMCddKSh0aGlzKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnYXR0YWNobWVudCdcbiAgICBjb25zdCBpc0lubGluZUF0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2lubGluZSdcbiAgICBpZiAoKGlzQXR0YWNobWVudCB8fCBpc0lubGluZUF0dGFjaG1lbnQpICYmIHRoaXMuY29udGVudFR5cGUudHlwZSAhPT0gJ3RleHQnICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9ICdiaW5hcnknXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudmFsdWUgPT09ICdtZXNzYWdlL3JmYzgyMicgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBQYXJzZSBtZXNzYWdlL3JmYzgyMiBvbmx5IGlmIHRoZSBtaW1lIHBhcnQgaXMgbm90IG1hcmtlZCB3aXRoIGNvbnRlbnQtZGlzcG9zaXRpb246IGF0dGFjaG1lbnQsXG4gICAgICAgKiBvdGhlcndpc2UgdHJlYXQgaXQgbGlrZSBhIHJlZ3VsYXIgYXR0YWNobWVudFxuICAgICAgICovXG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcylcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFt0aGlzLl9jdXJyZW50Q2hpbGRdXG4gICAgICB0aGlzLl9pc1JmYzgyMiA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHJhbnNmZXItRW5jb2RpbmcgdmFsdWUgdG8gc2VlIGlmIHRoZSBib2R5IG5lZWRzIHRvIGJlIGNvbnZlcnRlZFxuICAgKiBiZWZvcmUgaXQgY2FuIGJlIGVtaXR0ZWRcbiAgICovXG4gIF9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJzdiaXQnKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZycsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9IHBhdGhPcignJywgWydjb250ZW50VHJhbnNmZXJFbmNvZGluZycsICd2YWx1ZSddKSh0aGlzKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEJPRFkgc3RhdGUuIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgcmZjODIyIG5vZGUsXG4gICAqIHBhc3NlcyBsaW5lIHZhbHVlIHRvIGNoaWxkIG5vZGVzLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICovXG4gIF9wcm9jZXNzQm9keUxpbmUgKGxpbmUpIHtcbiAgICB0aGlzLl9saW5lQ291bnQrK1xuXG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0KSB7XG4gICAgICBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5KSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMpXG4gICAgICAgIHRoaXMuY2hpbGROb2Rlcy5wdXNoKHRoaXMuX2N1cnJlbnRDaGlsZClcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJy0tJykge1xuICAgICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gbGluZSArICdcXG4nXG4gICAgICAgIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZ25vcmUgbXVsdGlwYXJ0IHByZWFtYmxlXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLndyaXRlTGluZShsaW5lKVxuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgICBsZXQgY3VyTGluZSA9IHRoaXMuX2xpbmVSZW1haW5kZXIgKyBsaW5lLnRyaW0oKVxuXG4gICAgICAgICAgaWYgKGN1ckxpbmUubGVuZ3RoICUgNCkge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9IGN1ckxpbmUuc3Vic3RyKC1jdXJMaW5lLmxlbmd0aCAlIDQpXG4gICAgICAgICAgICBjdXJMaW5lID0gY3VyTGluZS5zdWJzdHIoMCwgY3VyTGluZS5sZW5ndGggLSB0aGlzLl9saW5lUmVtYWluZGVyLmxlbmd0aClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGN1ckxpbmUubGVuZ3RoKSB7XG4gICAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGJhc2U2NERlY29kZShjdXJMaW5lLCB0aGlzLmNoYXJzZXQpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6XG4gICAgICAgICAgY3VyTGluZSA9IHRoaXMuX2xpbmVSZW1haW5kZXIgKyAodGhpcy5fbGluZUNvdW50ID4gMSA/ICdcXG4nIDogJycpICsgbGluZVxuICAgICAgICAgIGNvbnN0IG1hdGNoID0gY3VyTGluZS5tYXRjaCgvPVthLWYwLTldezAsMX0kL2kpXG4gICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gbWF0Y2hbMF1cbiAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGN1ckxpbmUucmVwbGFjZSgvPShcXHI/XFxufCQpL2csICcnKS5yZXBsYWNlKC89KFthLWYwLTldezJ9KS9pZywgZnVuY3Rpb24gKG0sIGNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKHBhcnNlSW50KGNvZGUsIDE2KSlcbiAgICAgICAgICB9KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJzdiaXQnOlxuICAgICAgICBjYXNlICc4Yml0JzpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9ICh0aGlzLl9saW5lQ291bnQgPiAxID8gJ1xcbicgOiAnJykgKyBsaW5lXG4gICAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjaHVuayBvZiB0aGUgYm9keVxuICAqL1xuICBfZW1pdEJvZHkgKCkge1xuICAgIGlmICh0aGlzLl9pc011bHRpcGFydCB8fCAhdGhpcy5fYm9keUJ1ZmZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJvY2Vzc0Zsb3dlZFRleHQoKVxuICAgIHRoaXMuY29udGVudCA9IHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICB0aGlzLl9wcm9jZXNzSHRtbFRleHQoKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJ1xuICB9XG5cbiAgX3Byb2Nlc3NGbG93ZWRUZXh0ICgpIHtcbiAgICBjb25zdCBpc1RleHQgPSAvXnRleHRcXC8ocGxhaW58aHRtbCkkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKVxuICAgIGNvbnN0IGlzRmxvd2VkID0gL15mbG93ZWQkL2kudGVzdChwYXRoT3IoJycsIFsnY29udGVudFR5cGUnLCAncGFyYW1zJywgJ2Zvcm1hdCddKSh0aGlzKSlcbiAgICBpZiAoIWlzVGV4dCB8fCAhaXNGbG93ZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVsU3AgPSAvXnllcyQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUucGFyYW1zLmRlbHNwKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSB0aGlzLl9ib2R5QnVmZmVyLnNwbGl0KCdcXG4nKVxuICAgICAgLnJlZHVjZShmdW5jdGlvbiAocHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlKSB7XG4gICAgICAgIC8vIHJlbW92ZSBzb2Z0IGxpbmVicmVha3MgYWZ0ZXIgc3BhY2Ugc3ltYm9scy5cbiAgICAgICAgLy8gZGVsc3AgYWRkcyBzcGFjZXMgdG8gdGV4dCB0byBiZSBhYmxlIHRvIGZvbGQgaXQuXG4gICAgICAgIC8vIHRoZXNlIHNwYWNlcyBjYW4gYmUgcmVtb3ZlZCBvbmNlIHRoZSB0ZXh0IGlzIHVuZm9sZGVkXG4gICAgICAgIGNvbnN0IGVuZHNXaXRoU3BhY2UgPSAvICQvLnRlc3QocHJldmlvdXNWYWx1ZSlcbiAgICAgICAgY29uc3QgaXNCb3VuZGFyeSA9IC8oXnxcXG4pLS0gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICByZXR1cm4gKGRlbFNwID8gcHJldmlvdXNWYWx1ZS5yZXBsYWNlKC9bIF0rJC8sICcnKSA6IHByZXZpb3VzVmFsdWUpICsgKChlbmRzV2l0aFNwYWNlICYmICFpc0JvdW5kYXJ5KSA/ICcnIDogJ1xcbicpICsgY3VycmVudFZhbHVlXG4gICAgICB9KVxuICAgICAgLnJlcGxhY2UoL14gL2dtLCAnJykgLy8gcmVtb3ZlIHdoaXRlc3BhY2Ugc3R1ZmZpbmcgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzY3NiNzZWN0aW9uLTQuNFxuICB9XG5cbiAgX3Byb2Nlc3NIdG1sVGV4dCAoKSB7XG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gKHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddICYmIHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddWzBdKSB8fCBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGlzSHRtbCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNBdHRhY2htZW50ID0gL15hdHRhY2htZW50JC9pLnRlc3QoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlKVxuICAgIGlmIChpc0h0bWwgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYgL150ZXh0XFwvaHRtbCQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuX2RldGVjdEhUTUxDaGFyc2V0KHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgICB9XG5cbiAgICAgIC8vIGRlY29kZSBcImJpbmFyeVwiIHN0cmluZyB0byBhbiB1bmljb2RlIHN0cmluZ1xuICAgICAgaWYgKCEvXnV0ZlstX10/OCQvaS50ZXN0KHRoaXMuY2hhcnNldCkpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gY29udmVydChzdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpLCB0aGlzLmNoYXJzZXQgfHwgJ2lzby04ODU5LTEnKVxuICAgICAgfVxuXG4gICAgICAvLyBvdmVycmlkZSBjaGFyc2V0IGZvciB0ZXh0IG5vZGVzXG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ID0gJ3V0Zi04J1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlY3QgY2hhcnNldCBmcm9tIGEgaHRtbCBmaWxlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBodG1sIElucHV0IEhUTUxcbiAgICogQHJldHVybnMge1N0cmluZ30gQ2hhcnNldCBpZiBmb3VuZCBvciB1bmRlZmluZWRcbiAgICovXG4gIF9kZXRlY3RIVE1MQ2hhcnNldCAoaHRtbCkge1xuICAgIGxldCBjaGFyc2V0LCBpbnB1dFxuXG4gICAgaHRtbCA9IGh0bWwucmVwbGFjZSgvXFxyP1xcbnxcXHIvZywgJyAnKVxuICAgIGxldCBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMraHR0cC1lcXVpdj1bXCInXFxzXSpjb250ZW50LXR5cGVbXj5dKj8+L2kpXG4gICAgaWYgKG1ldGEpIHtcbiAgICAgIGlucHV0ID0gbWV0YVswXVxuICAgIH1cblxuICAgIGlmIChpbnB1dCkge1xuICAgICAgY2hhcnNldCA9IGlucHV0Lm1hdGNoKC9jaGFyc2V0XFxzPz1cXHM/KFthLXpBLVpcXC1fOjAtOV0qKTs/LylcbiAgICAgIGlmIChjaGFyc2V0KSB7XG4gICAgICAgIGNoYXJzZXQgPSAoY2hhcnNldFsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMrY2hhcnNldD1bXCInXFxzXSooW15cIic8Pi9cXHNdKykvaSlcbiAgICBpZiAoIWNoYXJzZXQgJiYgbWV0YSkge1xuICAgICAgY2hhcnNldCA9IChtZXRhWzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFyc2V0XG4gIH1cbn1cblxuY29uc3Qgc3RyMmFyciA9IHN0ciA9PiBuZXcgVWludDhBcnJheShzdHIuc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIuY2hhckNvZGVBdCgwKSkpXG4iXX0=
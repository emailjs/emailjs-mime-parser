'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ramda = require('ramda');

var _timezones = require('./timezones');

var _timezones2 = _interopRequireDefault(_timezones);

var _emailjsMimeCodec = require('emailjs-mime-codec');

var _emailjsBase = require('emailjs-base64');

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

      if (this.contentType.value === 'message/rfc822') {
        /**
         * Parse message/rfc822 only if the mime part is not marked with content-disposition: attachment,
         * otherwise treat it like a regular attachment
         */
        var _defaultValue = (0, _emailjsMimeCodec.parseHeaderValue)('');
        var contentDisposition = (0, _ramda.pathOr)(_defaultValue, ['headers', 'content-disposition', '0'])(this);
        if ((contentDisposition.value || '').toLowerCase().trim() !== 'attachment') {
          this._currentChild = new MimeNode(this);
          this.childNodes = [this._currentChild];
          this._isRfc822 = true;
        }
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
              this._bodyBuffer += (0, _emailjsBase.decode)(curLine);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9ub2RlLmpzIl0sIm5hbWVzIjpbIk1pbWVOb2RlIiwiaGVhZGVyIiwiaGVhZGVycyIsImJvZHlzdHJ1Y3R1cmUiLCJjaGlsZE5vZGVzIiwicmF3IiwiX3N0YXRlIiwiX2JvZHlCdWZmZXIiLCJfbGluZUNvdW50IiwiX2N1cnJlbnRDaGlsZCIsIl9saW5lUmVtYWluZGVyIiwiX2lzTXVsdGlwYXJ0IiwiX211bHRpcGFydEJvdW5kYXJ5IiwiX2lzUmZjODIyIiwibGluZSIsIl9wcm9jZXNzSGVhZGVyTGluZSIsIl9wcm9jZXNzQm9keUxpbmUiLCJmaW5hbGl6ZSIsIl9lbWl0Qm9keSIsInJlZHVjZSIsImFnZyIsImNoaWxkIiwiam9pbiIsIl9wYXJzZUhlYWRlcnMiLCJtYXRjaCIsImxlbmd0aCIsInB1c2giLCJoYXNCaW5hcnkiLCJpIiwibGVuIiwidmFsdWUiLCJzcGxpdCIsImtleSIsInNoaWZ0IiwidHJpbSIsInRvTG93ZXJDYXNlIiwicmVwbGFjZSIsImNoYXJzZXQiLCJzdHIyYXJyIiwiY29uY2F0IiwiX3BhcnNlSGVhZGVyVmFsdWUiLCJwYXJhbXMiLCJfcHJvY2Vzc0NvbnRlbnRUeXBlIiwiX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInBhcnNlZFZhbHVlIiwiaXNBZGRyZXNzIiwiX3BhcnNlRGF0ZSIsImluaXRpYWwiLCJfZGVjb2RlSGVhZGVyQ2hhcnNldCIsInN0ciIsImRhdGUiLCJEYXRlIiwidHoiLCJ0b1VwcGVyQ2FzZSIsInRvU3RyaW5nIiwidG9VVENTdHJpbmciLCJwYXJzZWQiLCJPYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsIkFycmF5IiwiaXNBcnJheSIsImFkZHIiLCJuYW1lIiwiZ3JvdXAiLCJkZWZhdWx0VmFsdWUiLCJjb250ZW50VHlwZSIsInR5cGUiLCJib3VuZGFyeSIsInBvcCIsImNvbnRlbnREaXNwb3NpdGlvbiIsImNvbnRlbnRUcmFuc2ZlckVuY29kaW5nIiwid3JpdGVMaW5lIiwiY3VyTGluZSIsInN1YnN0ciIsIm0iLCJjb2RlIiwiU3RyaW5nIiwiZnJvbUNoYXJDb2RlIiwicGFyc2VJbnQiLCJfcHJvY2Vzc0Zsb3dlZFRleHQiLCJjb250ZW50IiwiX3Byb2Nlc3NIdG1sVGV4dCIsImlzVGV4dCIsInRlc3QiLCJpc0Zsb3dlZCIsImRlbFNwIiwiZGVsc3AiLCJwcmV2aW91c1ZhbHVlIiwiY3VycmVudFZhbHVlIiwiZW5kc1dpdGhTcGFjZSIsImlzQm91bmRhcnkiLCJpc0h0bWwiLCJpc0F0dGFjaG1lbnQiLCJfZGV0ZWN0SFRNTENoYXJzZXQiLCJodG1sIiwiaW5wdXQiLCJtZXRhIiwiVWludDhBcnJheSIsIm1hcCIsImNoYXIiLCJjaGFyQ29kZUF0Il0sIm1hcHBpbmdzIjoiOzs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7Ozs7O0lBRXFCQSxRO0FBQ25CLHNCQUFlO0FBQUE7O0FBQ2IsU0FBS0MsTUFBTCxHQUFjLEVBQWQsQ0FEYSxDQUNJO0FBQ2pCLFNBQUtDLE9BQUwsR0FBZSxFQUFmLENBRmEsQ0FFSztBQUNsQixTQUFLQyxhQUFMLEdBQXFCLEVBQXJCO0FBQ0EsU0FBS0MsVUFBTCxHQUFrQixFQUFsQixDQUphLENBSVE7QUFDckIsU0FBS0MsR0FBTCxHQUFXLEVBQVgsQ0FMYSxDQUtDOztBQUVkLFNBQUtDLE1BQUwsR0FBYyxRQUFkLENBUGEsQ0FPVTtBQUN2QixTQUFLQyxXQUFMLEdBQW1CLEVBQW5CLENBUmEsQ0FRUztBQUN0QixTQUFLQyxVQUFMLEdBQWtCLENBQWxCLENBVGEsQ0FTTztBQUNwQixTQUFLQyxhQUFMLEdBQXFCLEtBQXJCLENBVmEsQ0FVYztBQUMzQixTQUFLQyxjQUFMLEdBQXNCLEVBQXRCLENBWGEsQ0FXWTtBQUN6QixTQUFLQyxZQUFMLEdBQW9CLEtBQXBCLENBWmEsQ0FZYTtBQUMxQixTQUFLQyxrQkFBTCxHQUEwQixLQUExQixDQWJhLENBYW1CO0FBQ2hDLFNBQUtDLFNBQUwsR0FBaUIsS0FBakIsQ0FkYSxDQWNVO0FBQ3hCOzs7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O0FBRUFELGFBQU9BLEtBQUszRCxPQUFMLENBQWEsV0FBYixFQUEwQixHQUExQixDQUFQO0FBQ0EsVUFBSTZELE9BQU9GLEtBQUt2RSxLQUFMLENBQVcsZ0RBQVgsQ0FBWDtBQUNBLFVBQUl5RSxJQUFKLEVBQVU7QUFDUkQsZ0JBQVFDLEtBQUssQ0FBTCxDQUFSO0FBQ0Q7O0FBRUQsVUFBSUQsS0FBSixFQUFXO0FBQ1QzRCxrQkFBVTJELE1BQU14RSxLQUFOLENBQVksb0NBQVosQ0FBVjtBQUNBLFlBQUlhLE9BQUosRUFBYTtBQUNYQSxvQkFBVSxDQUFDQSxRQUFRLENBQVIsS0FBYyxFQUFmLEVBQW1CSCxJQUFuQixHQUEwQkMsV0FBMUIsRUFBVjtBQUNEO0FBQ0Y7O0FBRUQ4RCxhQUFPRixLQUFLdkUsS0FBTCxDQUFXLHVDQUFYLENBQVA7QUFDQSxVQUFJLENBQUNhLE9BQUQsSUFBWTRELElBQWhCLEVBQXNCO0FBQ3BCNUQsa0JBQVUsQ0FBQzRELEtBQUssQ0FBTCxLQUFXLEVBQVosRUFBZ0IvRCxJQUFoQixHQUF1QkMsV0FBdkIsRUFBVjtBQUNEOztBQUVELGFBQU9FLE9BQVA7QUFDRDs7Ozs7O2tCQXpYa0JyQyxROzs7QUE0WHJCLElBQU1zQyxVQUFVLFNBQVZBLE9BQVU7QUFBQSxTQUFPLElBQUk0RCxVQUFKLENBQWVqRCxJQUFJbEIsS0FBSixDQUFVLEVBQVYsRUFBY29FLEdBQWQsQ0FBa0I7QUFBQSxXQUFRQyxLQUFLQyxVQUFMLENBQWdCLENBQWhCLENBQVI7QUFBQSxHQUFsQixDQUFmLENBQVA7QUFBQSxDQUFoQiIsImZpbGUiOiJub2RlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcGF0aE9yIH0gZnJvbSAncmFtZGEnXG5pbXBvcnQgdGltZXpvbmUgZnJvbSAnLi90aW1lem9uZXMnXG5pbXBvcnQgeyBkZWNvZGUsIGNvbnZlcnQsIHBhcnNlSGVhZGVyVmFsdWUsIG1pbWVXb3Jkc0RlY29kZSB9IGZyb20gJ2VtYWlsanMtbWltZS1jb2RlYydcbmltcG9ydCB7IGRlY29kZSBhcyBkZWNvZGVCYXNlNjQgfSBmcm9tICdlbWFpbGpzLWJhc2U2NCdcbmltcG9ydCBwYXJzZUFkZHJlc3MgZnJvbSAnZW1haWxqcy1hZGRyZXNzcGFyc2VyJ1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNaW1lTm9kZSB7XG4gIGNvbnN0cnVjdG9yICgpIHtcbiAgICB0aGlzLmhlYWRlciA9IFtdIC8vIEFuIGFycmF5IG9mIHVuZm9sZGVkIGhlYWRlciBsaW5lc1xuICAgIHRoaXMuaGVhZGVycyA9IHt9IC8vIEFuIG9iamVjdCB0aGF0IGhvbGRzIGhlYWRlciBrZXk9dmFsdWUgcGFpcnNcbiAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgPSAnJ1xuICAgIHRoaXMuY2hpbGROb2RlcyA9IFtdIC8vIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgbWVzc2FnZS9yZmM4MjIgbWltZSBwYXJ0LCB0aGUgdmFsdWUgd2lsbCBiZSBjb252ZXJ0ZWQgdG8gYXJyYXkgYW5kIGhvbGQgYWxsIGNoaWxkIG5vZGVzIGZvciB0aGlzIG5vZGVcbiAgICB0aGlzLnJhdyA9ICcnIC8vIFN0b3JlcyB0aGUgcmF3IGNvbnRlbnQgb2YgdGhpcyBub2RlXG5cbiAgICB0aGlzLl9zdGF0ZSA9ICdIRUFERVInIC8vIEN1cnJlbnQgc3RhdGUsIGFsd2F5cyBzdGFydHMgb3V0IHdpdGggSEVBREVSXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnIC8vIEJvZHkgYnVmZmVyXG4gICAgdGhpcy5fbGluZUNvdW50ID0gMCAvLyBMaW5lIGNvdW50ZXIgYm9yIHRoZSBib2R5IHBhcnRcbiAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBmYWxzZSAvLyBBY3RpdmUgY2hpbGQgbm9kZSAoaWYgYXZhaWxhYmxlKVxuICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJyAvLyBSZW1haW5kZXIgc3RyaW5nIHdoZW4gZGVhbGluZyB3aXRoIGJhc2U2NCBhbmQgcXAgdmFsdWVzXG4gICAgdGhpcy5faXNNdWx0aXBhcnQgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSBmYWxzZSAvLyBTdG9yZXMgYm91bmRhcnkgdmFsdWUgZm9yIGN1cnJlbnQgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9pc1JmYzgyMiA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbWVzc2FnZS9yZmM4MjIgbm9kZVxuICB9XG5cbiAgd3JpdGVMaW5lIChsaW5lKSB7XG4gICAgdGhpcy5yYXcgKz0gKHRoaXMucmF3ID8gJ1xcbicgOiAnJykgKyBsaW5lXG5cbiAgICBpZiAodGhpcy5fc3RhdGUgPT09ICdIRUFERVInKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzSGVhZGVyTGluZShsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5fc3RhdGUgPT09ICdCT0RZJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0JvZHlMaW5lKGxpbmUpXG4gICAgfVxuICB9XG5cbiAgZmluYWxpemUgKCkge1xuICAgIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZW1pdEJvZHkoKVxuICAgIH1cblxuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9IHRoaXMuY2hpbGROb2Rlc1xuICAgIC5yZWR1Y2UoKGFnZywgY2hpbGQpID0+IGFnZyArICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICdcXG4nICsgY2hpbGQuYm9keXN0cnVjdHVyZSwgdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJykgK1xuICAgICh0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA/ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICctLVxcbicgOiAnJylcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgYSBsaW5lIGluIHRoZSBIRUFERVIgc3RhdGUuIEl0IHRoZSBsaW5lIGlzIGVtcHR5LCBjaGFuZ2Ugc3RhdGUgdG8gQk9EWVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICovXG4gIF9wcm9jZXNzSGVhZGVyTGluZSAobGluZSkge1xuICAgIGlmICghbGluZSkge1xuICAgICAgdGhpcy5fcGFyc2VIZWFkZXJzKClcbiAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSB0aGlzLmhlYWRlci5qb2luKCdcXG4nKSArICdcXG5cXG4nXG4gICAgICB0aGlzLl9zdGF0ZSA9ICdCT0RZJ1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgaWYgKGxpbmUubWF0Y2goL15cXHMvKSAmJiB0aGlzLmhlYWRlci5sZW5ndGgpIHtcbiAgICAgIHRoaXMuaGVhZGVyW3RoaXMuaGVhZGVyLmxlbmd0aCAtIDFdICs9ICdcXG4nICsgbGluZVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmhlYWRlci5wdXNoKGxpbmUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEpvaW5zIGZvbGRlZCBoZWFkZXIgbGluZXMgYW5kIGNhbGxzIENvbnRlbnQtVHlwZSBhbmQgVHJhbnNmZXItRW5jb2RpbmcgcHJvY2Vzc29yc1xuICAgKi9cbiAgX3BhcnNlSGVhZGVycyAoKSB7XG4gICAgZm9yIChsZXQgaGFzQmluYXJ5ID0gZmFsc2UsIGkgPSAwLCBsZW4gPSB0aGlzLmhlYWRlci5sZW5ndGg7IGkgPCBsZW47IGkrKykge1xuICAgICAgbGV0IHZhbHVlID0gdGhpcy5oZWFkZXJbaV0uc3BsaXQoJzonKVxuICAgICAgY29uc3Qga2V5ID0gKHZhbHVlLnNoaWZ0KCkgfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgICB2YWx1ZSA9ICh2YWx1ZS5qb2luKCc6JykgfHwgJycpLnJlcGxhY2UoL1xcbi9nLCAnJykudHJpbSgpXG5cbiAgICAgIGlmICh2YWx1ZS5tYXRjaCgvW1xcdTAwODAtXFx1RkZGRl0vKSkge1xuICAgICAgICBpZiAoIXRoaXMuY2hhcnNldCkge1xuICAgICAgICAgIGhhc0JpbmFyeSA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICAvLyB1c2UgZGVmYXVsdCBjaGFyc2V0IGF0IGZpcnN0IGFuZCBpZiB0aGUgYWN0dWFsIGNoYXJzZXQgaXMgcmVzb2x2ZWQsIHRoZSBjb252ZXJzaW9uIGlzIHJlLXJ1blxuICAgICAgICB2YWx1ZSA9IGRlY29kZShjb252ZXJ0KHN0cjJhcnIodmFsdWUpLCB0aGlzLmNoYXJzZXQgfHwgJ2lzby04ODU5LTEnKSlcbiAgICAgIH1cblxuICAgICAgdGhpcy5oZWFkZXJzW2tleV0gPSAodGhpcy5oZWFkZXJzW2tleV0gfHwgW10pLmNvbmNhdChbdGhpcy5fcGFyc2VIZWFkZXJWYWx1ZShrZXksIHZhbHVlKV0pXG5cbiAgICAgIGlmICghdGhpcy5jaGFyc2V0ICYmIGtleSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5oZWFkZXJzW2tleV1bdGhpcy5oZWFkZXJzW2tleV0ubGVuZ3RoIC0gMV0ucGFyYW1zLmNoYXJzZXRcbiAgICAgIH1cblxuICAgICAgaWYgKGhhc0JpbmFyeSAmJiB0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgLy8gcmVzZXQgdmFsdWVzIGFuZCBzdGFydCBvdmVyIG9uY2UgY2hhcnNldCBoYXMgYmVlbiByZXNvbHZlZCBhbmQgOGJpdCBjb250ZW50IGhhcyBiZWVuIGZvdW5kXG4gICAgICAgIGhhc0JpbmFyeSA9IGZhbHNlXG4gICAgICAgIHRoaXMuaGVhZGVycyA9IHt9XG4gICAgICAgIGkgPSAtMSAvLyBuZXh0IGl0ZXJhdGlvbiBoYXMgaSA9PSAwXG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUeXBlKClcbiAgICB0aGlzLl9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcoKVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBzaW5nbGUgaGVhZGVyIHZhbHVlXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBrZXkgSGVhZGVyIGtleVxuICAgKiBAcGFyYW0ge1N0cmluZ30gdmFsdWUgVmFsdWUgZm9yIHRoZSBrZXlcbiAgICogQHJldHVybiB7T2JqZWN0fSBwYXJzZWQgaGVhZGVyXG4gICAqL1xuICBfcGFyc2VIZWFkZXJWYWx1ZSAoa2V5LCB2YWx1ZSkge1xuICAgIGxldCBwYXJzZWRWYWx1ZVxuICAgIGxldCBpc0FkZHJlc3MgPSBmYWxzZVxuXG4gICAgc3dpdGNoIChrZXkpIHtcbiAgICAgIGNhc2UgJ2NvbnRlbnQtdHlwZSc6XG4gICAgICBjYXNlICdjb250ZW50LXRyYW5zZmVyLWVuY29kaW5nJzpcbiAgICAgIGNhc2UgJ2NvbnRlbnQtZGlzcG9zaXRpb24nOlxuICAgICAgY2FzZSAnZGtpbS1zaWduYXR1cmUnOlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUodmFsdWUpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdmcm9tJzpcbiAgICAgIGNhc2UgJ3NlbmRlcic6XG4gICAgICBjYXNlICd0byc6XG4gICAgICBjYXNlICdyZXBseS10byc6XG4gICAgICBjYXNlICdjYyc6XG4gICAgICBjYXNlICdiY2MnOlxuICAgICAgY2FzZSAnYWJ1c2UtcmVwb3J0cy10byc6XG4gICAgICBjYXNlICdlcnJvcnMtdG8nOlxuICAgICAgY2FzZSAncmV0dXJuLXBhdGgnOlxuICAgICAgY2FzZSAnZGVsaXZlcmVkLXRvJzpcbiAgICAgICAgaXNBZGRyZXNzID0gdHJ1ZVxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogW10uY29uY2F0KHBhcnNlQWRkcmVzcyh2YWx1ZSkgfHwgW10pXG4gICAgICAgIH1cbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2RhdGUnOlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogdGhpcy5fcGFyc2VEYXRlKHZhbHVlKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBwYXJzZWRWYWx1ZSA9IHtcbiAgICAgICAgICB2YWx1ZTogdmFsdWVcbiAgICAgICAgfVxuICAgIH1cbiAgICBwYXJzZWRWYWx1ZS5pbml0aWFsID0gdmFsdWVcblxuICAgIHRoaXMuX2RlY29kZUhlYWRlckNoYXJzZXQocGFyc2VkVmFsdWUsIHsgaXNBZGRyZXNzIH0pXG5cbiAgICByZXR1cm4gcGFyc2VkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBkYXRlIHN0cmluZyBjYW4gYmUgcGFyc2VkLiBGYWxscyBiYWNrIHJlcGxhY2luZyB0aW1lem9uZVxuICAgKiBhYmJyZXZhdGlvbnMgd2l0aCB0aW1lem9uZSB2YWx1ZXMuIEJvZ3VzIHRpbWV6b25lcyBkZWZhdWx0IHRvIFVUQy5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IHN0ciBEYXRlIGhlYWRlclxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBVVEMgZGF0ZSBzdHJpbmcgaWYgcGFyc2luZyBzdWNjZWVkZWQsIG90aGVyd2lzZSByZXR1cm5zIGlucHV0IHZhbHVlXG4gICAqL1xuICBfcGFyc2VEYXRlIChzdHIgPSAnJykge1xuICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZShzdHIudHJpbSgpLnJlcGxhY2UoL1xcYlthLXpdKyQvaSwgdHogPT4gdGltZXpvbmVbdHoudG9VcHBlckNhc2UoKV0gfHwgJyswMDAwJykpXG4gICAgcmV0dXJuIChkYXRlLnRvU3RyaW5nKCkgIT09ICdJbnZhbGlkIERhdGUnKSA/IGRhdGUudG9VVENTdHJpbmcoKS5yZXBsYWNlKC9HTVQvLCAnKzAwMDAnKSA6IHN0clxuICB9XG5cbiAgX2RlY29kZUhlYWRlckNoYXJzZXQgKHBhcnNlZCwgeyBpc0FkZHJlc3MgfSA9IHt9KSB7XG4gICAgLy8gZGVjb2RlIGRlZmF1bHQgdmFsdWVcbiAgICBpZiAodHlwZW9mIHBhcnNlZC52YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHBhcnNlZC52YWx1ZSA9IG1pbWVXb3Jkc0RlY29kZShwYXJzZWQudmFsdWUpXG4gICAgfVxuXG4gICAgLy8gZGVjb2RlIHBvc3NpYmxlIHBhcmFtc1xuICAgIE9iamVjdC5rZXlzKHBhcnNlZC5wYXJhbXMgfHwge30pLmZvckVhY2goZnVuY3Rpb24gKGtleSkge1xuICAgICAgaWYgKHR5cGVvZiBwYXJzZWQucGFyYW1zW2tleV0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHBhcnNlZC5wYXJhbXNba2V5XSA9IG1pbWVXb3Jkc0RlY29kZShwYXJzZWQucGFyYW1zW2tleV0pXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIGRlY29kZSBhZGRyZXNzZXNcbiAgICBpZiAoaXNBZGRyZXNzICYmIEFycmF5LmlzQXJyYXkocGFyc2VkLnZhbHVlKSkge1xuICAgICAgcGFyc2VkLnZhbHVlLmZvckVhY2goYWRkciA9PiB7XG4gICAgICAgIGlmIChhZGRyLm5hbWUpIHtcbiAgICAgICAgICBhZGRyLm5hbWUgPSBtaW1lV29yZHNEZWNvZGUoYWRkci5uYW1lKVxuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGFkZHIuZ3JvdXApKSB7XG4gICAgICAgICAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHsgdmFsdWU6IGFkZHIuZ3JvdXAgfSwgeyBpc0FkZHJlc3M6IHRydWUgfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcnNlZFxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBDb250ZW50LVR5cGUgdmFsdWUgYW5kIHNlbGVjdHMgZm9sbG93aW5nIGFjdGlvbnMuXG4gICAqL1xuICBfcHJvY2Vzc0NvbnRlbnRUeXBlICgpIHtcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCd0ZXh0L3BsYWluJylcbiAgICB0aGlzLmNvbnRlbnRUeXBlID0gcGF0aE9yKGRlZmF1bHRWYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtdHlwZScsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHlwZS52YWx1ZSA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICAgIHRoaXMuY29udGVudFR5cGUudHlwZSA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlLnNwbGl0KCcvJykuc2hpZnQoKSB8fCAndGV4dCcpXG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS5wYXJhbXMgJiYgdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldCAmJiAhdGhpcy5jaGFyc2V0KSB7XG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudHlwZSA9PT0gJ211bHRpcGFydCcgJiYgdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuYm91bmRhcnkpIHtcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFtdXG4gICAgICB0aGlzLl9pc011bHRpcGFydCA9ICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlLnNwbGl0KCcvJykucG9wKCkgfHwgJ21peGVkJylcbiAgICAgIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuYm91bmRhcnlcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS52YWx1ZSA9PT0gJ21lc3NhZ2UvcmZjODIyJykge1xuICAgICAgLyoqXG4gICAgICAgKiBQYXJzZSBtZXNzYWdlL3JmYzgyMiBvbmx5IGlmIHRoZSBtaW1lIHBhcnQgaXMgbm90IG1hcmtlZCB3aXRoIGNvbnRlbnQtZGlzcG9zaXRpb246IGF0dGFjaG1lbnQsXG4gICAgICAgKiBvdGhlcndpc2UgdHJlYXQgaXQgbGlrZSBhIHJlZ3VsYXIgYXR0YWNobWVudFxuICAgICAgICovXG4gICAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gcGF0aE9yKGRlZmF1bHRWYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLCAnMCddKSh0aGlzKVxuICAgICAgaWYgKChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpICE9PSAnYXR0YWNobWVudCcpIHtcbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMpXG4gICAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFt0aGlzLl9jdXJyZW50Q2hpbGRdXG4gICAgICAgIHRoaXMuX2lzUmZjODIyID0gdHJ1ZVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UcmFuc2Zlci1FbmNvZGluZyB2YWx1ZSB0byBzZWUgaWYgdGhlIGJvZHkgbmVlZHMgdG8gYmUgY29udmVydGVkXG4gICAqIGJlZm9yZSBpdCBjYW4gYmUgZW1pdHRlZFxuICAgKi9cbiAgX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgnN2JpdCcpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZyA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXRyYW5zZmVyLWVuY29kaW5nJywgJzAnXSkodGhpcylcbiAgICB0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlID0gcGF0aE9yKCcnLCBbJ2NvbnRlbnRUcmFuc2ZlckVuY29kaW5nJywgJ3ZhbHVlJ10pKHRoaXMpLnRvTG93ZXJDYXNlKCkudHJpbSgpXG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgQk9EWSBzdGF0ZS4gSWYgdGhpcyBpcyBhIG11bHRpcGFydCBvciByZmM4MjIgbm9kZSxcbiAgICogcGFzc2VzIGxpbmUgdmFsdWUgdG8gY2hpbGQgbm9kZXMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBsaW5lIEVudGlyZSBpbnB1dCBsaW5lIGFzICdiaW5hcnknIHN0cmluZ1xuICAgKi9cbiAgX3Byb2Nlc3NCb2R5TGluZSAobGluZSkge1xuICAgIHRoaXMuX2xpbmVDb3VudCsrXG5cbiAgICBpZiAodGhpcy5faXNNdWx0aXBhcnQpIHtcbiAgICAgIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkpIHtcbiAgICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IGxpbmUgKyAnXFxuJ1xuICAgICAgICBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcylcbiAgICAgICAgdGhpcy5jaGlsZE5vZGVzLnB1c2godGhpcy5fY3VycmVudENoaWxkKVxuICAgICAgfSBlbHNlIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS0nKSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2VcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC53cml0ZUxpbmUobGluZSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElnbm9yZSBtdWx0aXBhcnQgcHJlYW1ibGVcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUpXG4gICAgfSBlbHNlIHtcbiAgICAgIHN3aXRjaCAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSkge1xuICAgICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAgIGxldCBjdXJMaW5lID0gdGhpcy5fbGluZVJlbWFpbmRlciArIGxpbmUudHJpbSgpXG5cbiAgICAgICAgICBpZiAoY3VyTGluZS5sZW5ndGggJSA0KSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gY3VyTGluZS5zdWJzdHIoLWN1ckxpbmUubGVuZ3RoICUgNClcbiAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoY3VyTGluZS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gZGVjb2RlQmFzZTY0KGN1ckxpbmUpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6XG4gICAgICAgICAgY3VyTGluZSA9IHRoaXMuX2xpbmVSZW1haW5kZXIgKyAodGhpcy5fbGluZUNvdW50ID4gMSA/ICdcXG4nIDogJycpICsgbGluZVxuICAgICAgICAgIGNvbnN0IG1hdGNoID0gY3VyTGluZS5tYXRjaCgvPVthLWYwLTldezAsMX0kL2kpXG4gICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gbWF0Y2hbMF1cbiAgICAgICAgICAgIGN1ckxpbmUgPSBjdXJMaW5lLnN1YnN0cigwLCBjdXJMaW5lLmxlbmd0aCAtIHRoaXMuX2xpbmVSZW1haW5kZXIubGVuZ3RoKVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJydcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGN1ckxpbmUucmVwbGFjZSgvPShcXHI/XFxufCQpL2csICcnKS5yZXBsYWNlKC89KFthLWYwLTldezJ9KS9pZywgZnVuY3Rpb24gKG0sIGNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKHBhcnNlSW50KGNvZGUsIDE2KSlcbiAgICAgICAgICB9KVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJzdiaXQnOlxuICAgICAgICBjYXNlICc4Yml0JzpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9ICh0aGlzLl9saW5lQ291bnQgPiAxID8gJ1xcbicgOiAnJykgKyBsaW5lXG4gICAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjaHVuayBvZiB0aGUgYm9keVxuICAqL1xuICBfZW1pdEJvZHkgKCkge1xuICAgIGlmICh0aGlzLl9pc011bHRpcGFydCB8fCAhdGhpcy5fYm9keUJ1ZmZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJvY2Vzc0Zsb3dlZFRleHQoKVxuICAgIHRoaXMuY29udGVudCA9IHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICB0aGlzLl9wcm9jZXNzSHRtbFRleHQoKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJ1xuICB9XG5cbiAgX3Byb2Nlc3NGbG93ZWRUZXh0ICgpIHtcbiAgICBjb25zdCBpc1RleHQgPSAvXnRleHRcXC8ocGxhaW58aHRtbCkkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKVxuICAgIGNvbnN0IGlzRmxvd2VkID0gL15mbG93ZWQkL2kudGVzdChwYXRoT3IoJycsIFsnY29udGVudFR5cGUnLCAncGFyYW1zJywgJ2Zvcm1hdCddKSh0aGlzKSlcbiAgICBpZiAoIWlzVGV4dCB8fCAhaXNGbG93ZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVsU3AgPSAvXnllcyQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUucGFyYW1zLmRlbHNwKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSB0aGlzLl9ib2R5QnVmZmVyLnNwbGl0KCdcXG4nKVxuICAgICAgLnJlZHVjZShmdW5jdGlvbiAocHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlKSB7XG4gICAgICAgIC8vIHJlbW92ZSBzb2Z0IGxpbmVicmVha3MgYWZ0ZXIgc3BhY2Ugc3ltYm9scy5cbiAgICAgICAgLy8gZGVsc3AgYWRkcyBzcGFjZXMgdG8gdGV4dCB0byBiZSBhYmxlIHRvIGZvbGQgaXQuXG4gICAgICAgIC8vIHRoZXNlIHNwYWNlcyBjYW4gYmUgcmVtb3ZlZCBvbmNlIHRoZSB0ZXh0IGlzIHVuZm9sZGVkXG4gICAgICAgIGNvbnN0IGVuZHNXaXRoU3BhY2UgPSAvICQvLnRlc3QocHJldmlvdXNWYWx1ZSlcbiAgICAgICAgY29uc3QgaXNCb3VuZGFyeSA9IC8oXnxcXG4pLS0gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICByZXR1cm4gKGRlbFNwID8gcHJldmlvdXNWYWx1ZS5yZXBsYWNlKC9bIF0rJC8sICcnKSA6IHByZXZpb3VzVmFsdWUpICsgKChlbmRzV2l0aFNwYWNlICYmICFpc0JvdW5kYXJ5KSA/ICcnIDogJ1xcbicpICsgY3VycmVudFZhbHVlXG4gICAgICB9KVxuICAgICAgLnJlcGxhY2UoL14gL2dtLCAnJykgLy8gcmVtb3ZlIHdoaXRlc3BhY2Ugc3R1ZmZpbmcgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzY3NiNzZWN0aW9uLTQuNFxuICB9XG5cbiAgX3Byb2Nlc3NIdG1sVGV4dCAoKSB7XG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gKHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddICYmIHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddWzBdKSB8fCBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGlzSHRtbCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNBdHRhY2htZW50ID0gL15hdHRhY2htZW50JC9pLnRlc3QoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlKVxuICAgIGlmIChpc0h0bWwgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYgL150ZXh0XFwvaHRtbCQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuX2RldGVjdEhUTUxDaGFyc2V0KHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgICB9XG5cbiAgICAgIC8vIGRlY29kZSBcImJpbmFyeVwiIHN0cmluZyB0byBhbiB1bmljb2RlIHN0cmluZ1xuICAgICAgaWYgKCEvXnV0ZlstX10/OCQvaS50ZXN0KHRoaXMuY2hhcnNldCkpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gY29udmVydChzdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpLCB0aGlzLmNoYXJzZXQgfHwgJ2lzby04ODU5LTEnKVxuICAgICAgfVxuXG4gICAgICAvLyBvdmVycmlkZSBjaGFyc2V0IGZvciB0ZXh0IG5vZGVzXG4gICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ID0gJ3V0Zi04J1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlY3QgY2hhcnNldCBmcm9tIGEgaHRtbCBmaWxlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBodG1sIElucHV0IEhUTUxcbiAgICogQHJldHVybnMge1N0cmluZ30gQ2hhcnNldCBpZiBmb3VuZCBvciB1bmRlZmluZWRcbiAgICovXG4gIF9kZXRlY3RIVE1MQ2hhcnNldCAoaHRtbCkge1xuICAgIGxldCBjaGFyc2V0LCBpbnB1dFxuXG4gICAgaHRtbCA9IGh0bWwucmVwbGFjZSgvXFxyP1xcbnxcXHIvZywgJyAnKVxuICAgIGxldCBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMraHR0cC1lcXVpdj1bXCInXFxzXSpjb250ZW50LXR5cGVbXj5dKj8+L2kpXG4gICAgaWYgKG1ldGEpIHtcbiAgICAgIGlucHV0ID0gbWV0YVswXVxuICAgIH1cblxuICAgIGlmIChpbnB1dCkge1xuICAgICAgY2hhcnNldCA9IGlucHV0Lm1hdGNoKC9jaGFyc2V0XFxzPz1cXHM/KFthLXpBLVpcXC1fOjAtOV0qKTs/LylcbiAgICAgIGlmIChjaGFyc2V0KSB7XG4gICAgICAgIGNoYXJzZXQgPSAoY2hhcnNldFsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMrY2hhcnNldD1bXCInXFxzXSooW15cIic8Pi9cXHNdKykvaSlcbiAgICBpZiAoIWNoYXJzZXQgJiYgbWV0YSkge1xuICAgICAgY2hhcnNldCA9IChtZXRhWzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFyc2V0XG4gIH1cbn1cblxuY29uc3Qgc3RyMmFyciA9IHN0ciA9PiBuZXcgVWludDhBcnJheShzdHIuc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIuY2hhckNvZGVBdCgwKSkpXG4iXX0=
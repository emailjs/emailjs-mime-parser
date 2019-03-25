'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MimeNode = exports.NodeCounter = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

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

function parse(chunk) {
  var root = new MimeNode(new NodeCounter());
  var lines = ((typeof chunk === 'undefined' ? 'undefined' : _typeof(chunk)) === 'object' ? String.fromCharCode.apply(null, chunk) : chunk).split(/\r?\n/g);
  lines.forEach(function (line) {
    return root.writeLine(line);
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
          this._currentChild = new MimeNode(this.nodeCounter);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taW1lcGFyc2VyLmpzIl0sIm5hbWVzIjpbInBhcnNlIiwiTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUyIsIk5vZGVDb3VudGVyIiwiY291bnQiLCJFcnJvciIsImNodW5rIiwicm9vdCIsIk1pbWVOb2RlIiwibGluZXMiLCJTdHJpbmciLCJmcm9tQ2hhckNvZGUiLCJhcHBseSIsInNwbGl0IiwiZm9yRWFjaCIsIndyaXRlTGluZSIsImxpbmUiLCJmaW5hbGl6ZSIsIm5vZGVDb3VudGVyIiwiYnVtcCIsImhlYWRlciIsImhlYWRlcnMiLCJib2R5c3RydWN0dXJlIiwiY2hpbGROb2RlcyIsInJhdyIsIl9zdGF0ZSIsIl9ib2R5QnVmZmVyIiwiX2xpbmVDb3VudCIsIl9jdXJyZW50Q2hpbGQiLCJfbGluZVJlbWFpbmRlciIsIl9pc011bHRpcGFydCIsIl9tdWx0aXBhcnRCb3VuZGFyeSIsIl9pc1JmYzgyMiIsIl9wcm9jZXNzSGVhZGVyTGluZSIsIl9wcm9jZXNzQm9keUxpbmUiLCJfZW1pdEJvZHkiLCJyZWR1Y2UiLCJhZ2ciLCJjaGlsZCIsImpvaW4iLCJjb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInZhbHVlIiwiY2hhcnNldCIsInJlcGxhY2UiLCJtIiwiY29kZSIsInBhcnNlSW50IiwiX3BhcnNlSGVhZGVycyIsIm1hdGNoIiwibGVuZ3RoIiwicHVzaCIsImhhc0JpbmFyeSIsImkiLCJsZW4iLCJrZXkiLCJzaGlmdCIsInRyaW0iLCJ0b0xvd2VyQ2FzZSIsInN0cjJhcnIiLCJjb25jYXQiLCJfcGFyc2VIZWFkZXJWYWx1ZSIsInBhcmFtcyIsImZldGNoQ29udGVudFR5cGUiLCJfcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nIiwicGFyc2VkVmFsdWUiLCJpc0FkZHJlc3MiLCJfcGFyc2VEYXRlIiwiaW5pdGlhbCIsIl9kZWNvZGVIZWFkZXJDaGFyc2V0Iiwic3RyIiwiZGF0ZSIsIkRhdGUiLCJ0aW1lem9uZSIsInR6IiwidG9VcHBlckNhc2UiLCJ0b1N0cmluZyIsInRvVVRDU3RyaW5nIiwicGFyc2VkIiwiT2JqZWN0Iiwia2V5cyIsIkFycmF5IiwiaXNBcnJheSIsImFkZHIiLCJuYW1lIiwiZ3JvdXAiLCJkZWZhdWx0VmFsdWUiLCJjb250ZW50VHlwZSIsInR5cGUiLCJib3VuZGFyeSIsInBvcCIsImRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSIsImNvbnRlbnREaXNwb3NpdGlvbiIsImlzQXR0YWNobWVudCIsImlzSW5saW5lQXR0YWNobWVudCIsImN1ckxpbmUiLCJzdWJzdHIiLCJfZGVjb2RlQm9keUJ1ZmZlciIsIl9wcm9jZXNzRmxvd2VkVGV4dCIsImNvbnRlbnQiLCJfcHJvY2Vzc0h0bWxUZXh0IiwiaXNUZXh0IiwidGVzdCIsImlzRmxvd2VkIiwiZGVsU3AiLCJkZWxzcCIsInByZXZpb3VzVmFsdWUiLCJjdXJyZW50VmFsdWUiLCJlbmRzV2l0aFNwYWNlIiwiaXNCb3VuZGFyeSIsImlzSHRtbCIsImRldGVjdEhUTUxDaGFyc2V0IiwidXRmOFN0cjJhcnIiLCJodG1sIiwiaW5wdXQiLCJtZXRhIiwiVWludDhBcnJheSIsIm1hcCIsImNoYXIiLCJjaGFyQ29kZUF0IiwiVGV4dEVuY29kZXIiLCJlbmNvZGUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O2tCQXNCd0JBLEs7O0FBdEJ4Qjs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOzs7Ozs7OztBQUVBOzs7O0FBSUEsSUFBTUMsK0JBQStCLEdBQXJDOztJQUNhQyxXLFdBQUFBLFc7QUFDWCx5QkFBZTtBQUFBOztBQUNiLFNBQUtDLEtBQUwsR0FBYSxDQUFiO0FBQ0Q7Ozs7MkJBQ087QUFDTixVQUFJLEVBQUUsS0FBS0EsS0FBUCxHQUFlRiw0QkFBbkIsRUFBaUQ7QUFDL0MsY0FBTSxJQUFJRyxLQUFKLENBQVUsd0NBQVYsQ0FBTjtBQUNEO0FBQ0Y7Ozs7OztBQUdZLFNBQVNKLEtBQVQsQ0FBZ0JLLEtBQWhCLEVBQXVCO0FBQ3BDLE1BQU1DLE9BQU8sSUFBSUMs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eUQsVUFBSixDQUFlOUMsSUFBSXhELEtBQUosQ0FBVSxFQUFWLEVBQWN1RyxHQUFkLENBQWtCO0FBQUEsV0FBUUMsS0FBS0MsVUFBTCxDQUFnQixDQUFoQixDQUFSO0FBQUEsR0FBbEIsQ0FBZixDQUFQO0FBQUEsQ0FBaEI7QUFDQSxJQUFNUCxjQUFjLFNBQWRBLFdBQWM7QUFBQSxTQUFPLElBQUlRLHlCQUFKLENBQWdCLE9BQWhCLEVBQXlCQyxNQUF6QixDQUFnQ25ELEdBQWhDLENBQVA7QUFBQSxDQUFwQiIsImZpbGUiOiJtaW1lcGFyc2VyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcGF0aE9yIH0gZnJvbSAncmFtZGEnXG5pbXBvcnQgdGltZXpvbmUgZnJvbSAnLi90aW1lem9uZXMnXG5pbXBvcnQgeyBkZWNvZGUsIGJhc2U2NERlY29kZSwgY29udmVydCwgcGFyc2VIZWFkZXJWYWx1ZSwgbWltZVdvcmRzRGVjb2RlIH0gZnJvbSAnZW1haWxqcy1taW1lLWNvZGVjJ1xuaW1wb3J0IHsgVGV4dEVuY29kZXIgfSBmcm9tICd0ZXh0LWVuY29kaW5nJ1xuaW1wb3J0IHBhcnNlQWRkcmVzcyBmcm9tICdlbWFpbGpzLWFkZHJlc3NwYXJzZXInXG5cbi8qXG4gKiBDb3VudHMgTUlNRSBub2RlcyB0byBwcmV2ZW50IG1lbW9yeSBleGhhdXN0aW9uIGF0dGFja3MgKENXRS00MDApXG4gKiBzZWU6IGh0dHBzOi8vc255ay5pby92dWxuL25wbTplbWFpbGpzLW1pbWUtcGFyc2VyOjIwMTgwNjI1XG4gKi9cbmNvbnN0IE1BWElNVU1fTlVNQkVSX09GX01JTUVfTk9ERVMgPSA5OTlcbmV4cG9ydCBjbGFzcyBOb2RlQ291bnRlciB7XG4gIGNvbnN0cnVjdG9yICgpIHtcbiAgICB0aGlzLmNvdW50ID0gMFxuICB9XG4gIGJ1bXAgKCkge1xuICAgIGlmICgrK3RoaXMuY291bnQgPiBNQVhJTVVNX05VTUJFUl9PRl9NSU1FX05PREVTKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01heGltdW0gbnVtYmVyIG9mIE1JTUUgbm9kZXMgZXhjZWVkZWQhJylcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgZnVuY3Rpb24gcGFyc2UgKGNodW5rKSB7XG4gIGNvbnN0IHJvb3QgPSBuZXcgTWltZU5vZGUobmV3IE5vZGVDb3VudGVyKCkpXG4gIGNvbnN0IGxpbmVzID0gKHR5cGVvZiBjaHVuayA9PT0gJ29iamVjdCcgPyBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGNodW5rKSA6IGNodW5rKS5zcGxpdCgvXFxyP1xcbi9nKVxuICBsaW5lcy5mb3JFYWNoKGxpbmUgPT4gcm9vdC53cml0ZUxpbmUobGluZSkpXG4gIHJvb3QuZmluYWxpemUoKVxuICByZXR1cm4gcm9vdFxufVxuXG5leHBvcnQgY2xhc3MgTWltZU5vZGUge1xuICBjb25zdHJ1Y3RvciAobm9kZUNvdW50ZXIgPSBuZXcgTm9kZUNvdW50ZXIoKSkge1xuICAgIHRoaXMubm9kZUNvdW50ZXIgPSBub2RlQ291bnRlclxuICAgIHRoaXMubm9kZUNvdW50ZXIuYnVtcCgpXG5cbiAgICB0aGlzLmhlYWRlciA9IFtdIC8vIEFuIGFycmF5IG9mIHVuZm9sZGVkIGhlYWRlciBsaW5lc1xuICAgIHRoaXMuaGVhZGVycyA9IHt9IC8vIEFuIG9iamVjdCB0aGF0IGhvbGRzIGhlYWRlciBrZXk9dmFsdWUgcGFpcnNcbiAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgPSAnJ1xuICAgIHRoaXMuY2hpbGROb2RlcyA9IFtdIC8vIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgbWVzc2FnZS9yZmM4MjIgbWltZSBwYXJ0LCB0aGUgdmFsdWUgd2lsbCBiZSBjb252ZXJ0ZWQgdG8gYXJyYXkgYW5kIGhvbGQgYWxsIGNoaWxkIG5vZGVzIGZvciB0aGlzIG5vZGVcbiAgICB0aGlzLnJhdyA9ICcnIC8vIFN0b3JlcyB0aGUgcmF3IGNvbnRlbnQgb2YgdGhpcyBub2RlXG5cbiAgICB0aGlzLl9zdGF0ZSA9ICdIRUFERVInIC8vIEN1cnJlbnQgc3RhdGUsIGFsd2F5cyBzdGFydHMgb3V0IHdpdGggSEVBREVSXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnIC8vIEJvZHkgYnVmZmVyXG4gICAgdGhpcy5fbGluZUNvdW50ID0gMCAvLyBMaW5lIGNvdW50ZXIgYm9yIHRoZSBib2R5IHBhcnRcbiAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBmYWxzZSAvLyBBY3RpdmUgY2hpbGQgbm9kZSAoaWYgYXZhaWxhYmxlKVxuICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJyAvLyBSZW1haW5kZXIgc3RyaW5nIHdoZW4gZGVhbGluZyB3aXRoIGJhc2U2NCBhbmQgcXAgdmFsdWVzXG4gICAgdGhpcy5faXNNdWx0aXBhcnQgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSBmYWxzZSAvLyBTdG9yZXMgYm91bmRhcnkgdmFsdWUgZm9yIGN1cnJlbnQgbXVsdGlwYXJ0IG5vZGVcbiAgICB0aGlzLl9pc1JmYzgyMiA9IGZhbHNlIC8vIEluZGljYXRlcyBpZiB0aGlzIGlzIGEgbWVzc2FnZS9yZmM4MjIgbm9kZVxuICB9XG5cbiAgd3JpdGVMaW5lIChsaW5lKSB7XG4gICAgdGhpcy5yYXcgKz0gKHRoaXMucmF3ID8gJ1xcbicgOiAnJykgKyBsaW5lXG5cbiAgICBpZiAodGhpcy5fc3RhdGUgPT09ICdIRUFERVInKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzSGVhZGVyTGluZShsaW5lKVxuICAgIH0gZWxzZSBpZiAodGhpcy5fc3RhdGUgPT09ICdCT0RZJykge1xuICAgICAgdGhpcy5fcHJvY2Vzc0JvZHlMaW5lKGxpbmUpXG4gICAgfVxuICB9XG5cbiAgZmluYWxpemUgKCkge1xuICAgIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fZW1pdEJvZHkoKVxuICAgIH1cblxuICAgIHRoaXMuYm9keXN0cnVjdHVyZSA9IHRoaXMuY2hpbGROb2Rlc1xuICAgICAgLnJlZHVjZSgoYWdnLCBjaGlsZCkgPT4gYWdnICsgJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJ1xcbicgKyBjaGlsZC5ib2R5c3RydWN0dXJlLCB0aGlzLmhlYWRlci5qb2luKCdcXG4nKSArICdcXG5cXG4nKSArXG4gICAgICAodGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS1cXG4nIDogJycpXG4gIH1cblxuICBfZGVjb2RlQm9keUJ1ZmZlciAoKSB7XG4gICAgc3dpdGNoICh0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nLnZhbHVlKSB7XG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICB0aGlzLl9ib2R5QnVmZmVyID0gYmFzZTY0RGVjb2RlKHRoaXMuX2JvZHlCdWZmZXIsIHRoaXMuY2hhcnNldClcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ3F1b3RlZC1wcmludGFibGUnOiB7XG4gICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgPSB0aGlzLl9ib2R5QnVmZmVyXG4gICAgICAgICAgLnJlcGxhY2UoLz0oXFxyP1xcbnwkKS9nLCAnJylcbiAgICAgICAgICAucmVwbGFjZSgvPShbYS1mMC05XXsyfSkvaWcsIChtLCBjb2RlKSA9PiBTdHJpbmcuZnJvbUNoYXJDb2RlKHBhcnNlSW50KGNvZGUsIDE2KSkpXG4gICAgICAgIGJyZWFrXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEhFQURFUiBzdGF0ZS4gSXQgdGhlIGxpbmUgaXMgZW1wdHksIGNoYW5nZSBzdGF0ZSB0byBCT0RZXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBsaW5lIEVudGlyZSBpbnB1dCBsaW5lIGFzICdiaW5hcnknIHN0cmluZ1xuICAgKi9cbiAgX3Byb2Nlc3NIZWFkZXJMaW5lIChsaW5lKSB7XG4gICAgaWYgKCFsaW5lKSB7XG4gICAgICB0aGlzLl9wYXJzZUhlYWRlcnMoKVxuICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbidcbiAgICAgIHRoaXMuX3N0YXRlID0gJ0JPRFknXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAobGluZS5tYXRjaCgvXlxccy8pICYmIHRoaXMuaGVhZGVyLmxlbmd0aCkge1xuICAgICAgdGhpcy5oZWFkZXJbdGhpcy5oZWFkZXIubGVuZ3RoIC0gMV0gKz0gJ1xcbicgKyBsaW5lXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuaGVhZGVyLnB1c2gobGluZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogSm9pbnMgZm9sZGVkIGhlYWRlciBsaW5lcyBhbmQgY2FsbHMgQ29udGVudC1UeXBlIGFuZCBUcmFuc2Zlci1FbmNvZGluZyBwcm9jZXNzb3JzXG4gICAqL1xuICBfcGFyc2VIZWFkZXJzICgpIHtcbiAgICBmb3IgKGxldCBoYXNCaW5hcnkgPSBmYWxzZSwgaSA9IDAsIGxlbiA9IHRoaXMuaGVhZGVyLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBsZXQgdmFsdWUgPSB0aGlzLmhlYWRlcltpXS5zcGxpdCgnOicpXG4gICAgICBjb25zdCBrZXkgPSAodmFsdWUuc2hpZnQoKSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIHZhbHVlID0gKHZhbHVlLmpvaW4oJzonKSB8fCAnJykucmVwbGFjZSgvXFxuL2csICcnKS50cmltKClcblxuICAgICAgaWYgKHZhbHVlLm1hdGNoKC9bXFx1MDA4MC1cXHVGRkZGXS8pKSB7XG4gICAgICAgIGlmICghdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgICAgaGFzQmluYXJ5ID0gdHJ1ZVxuICAgICAgICB9XG4gICAgICAgIC8vIHVzZSBkZWZhdWx0IGNoYXJzZXQgYXQgZmlyc3QgYW5kIGlmIHRoZSBhY3R1YWwgY2hhcnNldCBpcyByZXNvbHZlZCwgdGhlIGNvbnZlcnNpb24gaXMgcmUtcnVuXG4gICAgICAgIHZhbHVlID0gZGVjb2RlKGNvbnZlcnQoc3RyMmFycih2YWx1ZSksIHRoaXMuY2hhcnNldCB8fCAnaXNvLTg4NTktMScpKVxuICAgICAgfVxuXG4gICAgICB0aGlzLmhlYWRlcnNba2V5XSA9ICh0aGlzLmhlYWRlcnNba2V5XSB8fCBbXSkuY29uY2F0KFt0aGlzLl9wYXJzZUhlYWRlclZhbHVlKGtleSwgdmFsdWUpXSlcblxuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYga2V5ID09PSAnY29udGVudC10eXBlJykge1xuICAgICAgICB0aGlzLmNoYXJzZXQgPSB0aGlzLmhlYWRlcnNba2V5XVt0aGlzLmhlYWRlcnNba2V5XS5sZW5ndGggLSAxXS5wYXJhbXMuY2hhcnNldFxuICAgICAgfVxuXG4gICAgICBpZiAoaGFzQmluYXJ5ICYmIHRoaXMuY2hhcnNldCkge1xuICAgICAgICAvLyByZXNldCB2YWx1ZXMgYW5kIHN0YXJ0IG92ZXIgb25jZSBjaGFyc2V0IGhhcyBiZWVuIHJlc29sdmVkIGFuZCA4Yml0IGNvbnRlbnQgaGFzIGJlZW4gZm91bmRcbiAgICAgICAgaGFzQmluYXJ5ID0gZmFsc2VcbiAgICAgICAgdGhpcy5oZWFkZXJzID0ge31cbiAgICAgICAgaSA9IC0xIC8vIG5leHQgaXRlcmF0aW9uIGhhcyBpID09IDBcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmZldGNoQ29udGVudFR5cGUoKVxuICAgIHRoaXMuX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZygpXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIHNpbmdsZSBoZWFkZXIgdmFsdWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IGtleSBIZWFkZXIga2V5XG4gICAqIEBwYXJhbSB7U3RyaW5nfSB2YWx1ZSBWYWx1ZSBmb3IgdGhlIGtleVxuICAgKiBAcmV0dXJuIHtPYmplY3R9IHBhcnNlZCBoZWFkZXJcbiAgICovXG4gIF9wYXJzZUhlYWRlclZhbHVlIChrZXksIHZhbHVlKSB7XG4gICAgbGV0IHBhcnNlZFZhbHVlXG4gICAgbGV0IGlzQWRkcmVzcyA9IGZhbHNlXG5cbiAgICBzd2l0Y2ggKGtleSkge1xuICAgICAgY2FzZSAnY29udGVudC10eXBlJzpcbiAgICAgIGNhc2UgJ2NvbnRlbnQtdHJhbnNmZXItZW5jb2RpbmcnOlxuICAgICAgY2FzZSAnY29udGVudC1kaXNwb3NpdGlvbic6XG4gICAgICBjYXNlICdka2ltLXNpZ25hdHVyZSc6XG4gICAgICAgIHBhcnNlZFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSh2YWx1ZSlcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2Zyb20nOlxuICAgICAgY2FzZSAnc2VuZGVyJzpcbiAgICAgIGNhc2UgJ3RvJzpcbiAgICAgIGNhc2UgJ3JlcGx5LXRvJzpcbiAgICAgIGNhc2UgJ2NjJzpcbiAgICAgIGNhc2UgJ2JjYyc6XG4gICAgICBjYXNlICdhYnVzZS1yZXBvcnRzLXRvJzpcbiAgICAgIGNhc2UgJ2Vycm9ycy10byc6XG4gICAgICBjYXNlICdyZXR1cm4tcGF0aCc6XG4gICAgICBjYXNlICdkZWxpdmVyZWQtdG8nOlxuICAgICAgICBpc0FkZHJlc3MgPSB0cnVlXG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiBbXS5jb25jYXQocGFyc2VBZGRyZXNzKHZhbHVlKSB8fCBbXSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZGF0ZSc6XG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiB0aGlzLl9wYXJzZURhdGUodmFsdWUpXG4gICAgICAgIH1cbiAgICAgICAgYnJlYWtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHBhcnNlZFZhbHVlID0ge1xuICAgICAgICAgIHZhbHVlOiB2YWx1ZVxuICAgICAgICB9XG4gICAgfVxuICAgIHBhcnNlZFZhbHVlLmluaXRpYWwgPSB2YWx1ZVxuXG4gICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldChwYXJzZWRWYWx1ZSwgeyBpc0FkZHJlc3MgfSlcblxuICAgIHJldHVybiBwYXJzZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIGRhdGUgc3RyaW5nIGNhbiBiZSBwYXJzZWQuIEZhbGxzIGJhY2sgcmVwbGFjaW5nIHRpbWV6b25lXG4gICAqIGFiYnJldmF0aW9ucyB3aXRoIHRpbWV6b25lIHZhbHVlcy4gQm9ndXMgdGltZXpvbmVzIGRlZmF1bHQgdG8gVVRDLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gc3RyIERhdGUgaGVhZGVyXG4gICAqIEByZXR1cm5zIHtTdHJpbmd9IFVUQyBkYXRlIHN0cmluZyBpZiBwYXJzaW5nIHN1Y2NlZWRlZCwgb3RoZXJ3aXNlIHJldHVybnMgaW5wdXQgdmFsdWVcbiAgICovXG4gIF9wYXJzZURhdGUgKHN0ciA9ICcnKSB7XG4gICAgY29uc3QgZGF0ZSA9IG5ldyBEYXRlKHN0ci50cmltKCkucmVwbGFjZSgvXFxiW2Etel0rJC9pLCB0eiA9PiB0aW1lem9uZVt0ei50b1VwcGVyQ2FzZSgpXSB8fCAnKzAwMDAnKSlcbiAgICByZXR1cm4gKGRhdGUudG9TdHJpbmcoKSAhPT0gJ0ludmFsaWQgRGF0ZScpID8gZGF0ZS50b1VUQ1N0cmluZygpLnJlcGxhY2UoL0dNVC8sICcrMDAwMCcpIDogc3RyXG4gIH1cblxuICBfZGVjb2RlSGVhZGVyQ2hhcnNldCAocGFyc2VkLCB7IGlzQWRkcmVzcyB9ID0ge30pIHtcbiAgICAvLyBkZWNvZGUgZGVmYXVsdCB2YWx1ZVxuICAgIGlmICh0eXBlb2YgcGFyc2VkLnZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcGFyc2VkLnZhbHVlID0gbWltZVdvcmRzRGVjb2RlKHBhcnNlZC52YWx1ZSlcbiAgICB9XG5cbiAgICAvLyBkZWNvZGUgcG9zc2libGUgcGFyYW1zXG4gICAgT2JqZWN0LmtleXMocGFyc2VkLnBhcmFtcyB8fCB7fSkuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICBpZiAodHlwZW9mIHBhcnNlZC5wYXJhbXNba2V5XSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcGFyc2VkLnBhcmFtc1trZXldID0gbWltZVdvcmRzRGVjb2RlKHBhcnNlZC5wYXJhbXNba2V5XSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gZGVjb2RlIGFkZHJlc3Nlc1xuICAgIGlmIChpc0FkZHJlc3MgJiYgQXJyYXkuaXNBcnJheShwYXJzZWQudmFsdWUpKSB7XG4gICAgICBwYXJzZWQudmFsdWUuZm9yRWFjaChhZGRyID0+IHtcbiAgICAgICAgaWYgKGFkZHIubmFtZSkge1xuICAgICAgICAgIGFkZHIubmFtZSA9IG1pbWVXb3Jkc0RlY29kZShhZGRyLm5hbWUpXG4gICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoYWRkci5ncm91cCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2RlY29kZUhlYWRlckNoYXJzZXQoeyB2YWx1ZTogYWRkci5ncm91cCB9LCB7IGlzQWRkcmVzczogdHJ1ZSB9KVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gcGFyc2VkXG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHlwZSB2YWx1ZSBhbmQgc2VsZWN0cyBmb2xsb3dpbmcgYWN0aW9ucy5cbiAgICovXG4gIGZldGNoQ29udGVudFR5cGUgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJ3RleHQvcGxhaW4nKVxuICAgIHRoaXMuY29udGVudFR5cGUgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10eXBlJywgJzAnXSkodGhpcylcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnZhbHVlID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpXG4gICAgdGhpcy5jb250ZW50VHlwZS50eXBlID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUuc3BsaXQoJy8nKS5zaGlmdCgpIHx8ICd0ZXh0JylcblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcyAmJiB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5jaGFyc2V0ICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXRcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jb250ZW50VHlwZS50eXBlID09PSAnbXVsdGlwYXJ0JyAmJiB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5ib3VuZGFyeSkge1xuICAgICAgdGhpcy5jaGlsZE5vZGVzID0gW11cbiAgICAgIHRoaXMuX2lzTXVsdGlwYXJ0ID0gKHRoaXMuY29udGVudFR5cGUudmFsdWUuc3BsaXQoJy8nKS5wb3AoKSB8fCAnbWl4ZWQnKVxuICAgICAgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgPSB0aGlzLmNvbnRlbnRUeXBlLnBhcmFtcy5ib3VuZGFyeVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEZvciBhdHRhY2htZW50IChpbmxpbmUvcmVndWxhcikgaWYgY2hhcnNldCBpcyBub3QgZGVmaW5lZCBhbmQgYXR0YWNobWVudCBpcyBub24tdGV4dC8qLFxuICAgICAqIHRoZW4gZGVmYXVsdCBjaGFyc2V0IHRvIGJpbmFyeS5cbiAgICAgKiBSZWZlciB0byBpc3N1ZTogaHR0cHM6Ly9naXRodWIuY29tL2VtYWlsanMvZW1haWxqcy1taW1lLXBhcnNlci9pc3N1ZXMvMThcbiAgICAgKi9cbiAgICBjb25zdCBkZWZhdWx0Q29udGVudERpc3Bvc2l0aW9uVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGNvbnRlbnREaXNwb3NpdGlvbiA9IHBhdGhPcihkZWZhdWx0Q29udGVudERpc3Bvc2l0aW9uVmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LWRpc3Bvc2l0aW9uJywgJzAnXSkodGhpcylcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2F0dGFjaG1lbnQnXG4gICAgY29uc3QgaXNJbmxpbmVBdHRhY2htZW50ID0gKGNvbnRlbnREaXNwb3NpdGlvbi52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKCkgPT09ICdpbmxpbmUnXG4gICAgaWYgKChpc0F0dGFjaG1lbnQgfHwgaXNJbmxpbmVBdHRhY2htZW50KSAmJiB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgIT09ICd0ZXh0JyAmJiAhdGhpcy5jaGFyc2V0KSB7XG4gICAgICB0aGlzLmNoYXJzZXQgPSAnYmluYXJ5J1xuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlID09PSAnbWVzc2FnZS9yZmM4MjInICYmICFpc0F0dGFjaG1lbnQpIHtcbiAgICAgIC8qKlxuICAgICAgICogUGFyc2UgbWVzc2FnZS9yZmM4MjIgb25seSBpZiB0aGUgbWltZSBwYXJ0IGlzIG5vdCBtYXJrZWQgd2l0aCBjb250ZW50LWRpc3Bvc2l0aW9uOiBhdHRhY2htZW50LFxuICAgICAgICogb3RoZXJ3aXNlIHRyZWF0IGl0IGxpa2UgYSByZWd1bGFyIGF0dGFjaG1lbnRcbiAgICAgICAqL1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMubm9kZUNvdW50ZXIpXG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbdGhpcy5fY3VycmVudENoaWxkXVxuICAgICAgdGhpcy5faXNSZmM4MjIgPSB0cnVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFBhcnNlcyBDb250ZW50LVRyYW5zZmVyLUVuY29kaW5nIHZhbHVlIHRvIHNlZSBpZiB0aGUgYm9keSBuZWVkcyB0byBiZSBjb252ZXJ0ZWRcbiAgICogYmVmb3JlIGl0IGNhbiBiZSBlbWl0dGVkXG4gICAqL1xuICBfcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nICgpIHtcbiAgICBjb25zdCBkZWZhdWx0VmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKCc3Yml0JylcbiAgICB0aGlzLmNvbnRlbnRUcmFuc2ZlckVuY29kaW5nID0gcGF0aE9yKGRlZmF1bHRWYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtdHJhbnNmZXItZW5jb2RpbmcnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUgPSBwYXRoT3IoJycsIFsnY29udGVudFRyYW5zZmVyRW5jb2RpbmcnLCAndmFsdWUnXSkodGhpcykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgYSBsaW5lIGluIHRoZSBCT0RZIHN0YXRlLiBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIHJmYzgyMiBub2RlLFxuICAgKiBwYXNzZXMgbGluZSB2YWx1ZSB0byBjaGlsZCBub2Rlcy5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0JvZHlMaW5lIChsaW5lKSB7XG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0KSB7XG4gICAgICBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5KSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gbmV3IE1pbWVOb2RlKHRoaXMubm9kZUNvdW50ZXIpXG4gICAgICAgIHRoaXMuY2hpbGROb2Rlcy5wdXNoKHRoaXMuX2N1cnJlbnRDaGlsZClcbiAgICAgIH0gZWxzZSBpZiAobGluZSA9PT0gJy0tJyArIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ICsgJy0tJykge1xuICAgICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gbGluZSArICdcXG4nXG4gICAgICAgIGlmICh0aGlzLl9jdXJyZW50Q2hpbGQpIHtcbiAgICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZCA9IGZhbHNlXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZ25vcmUgbXVsdGlwYXJ0IHByZWFtYmxlXG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLl9pc1JmYzgyMikge1xuICAgICAgdGhpcy5fY3VycmVudENoaWxkLndyaXRlTGluZShsaW5lKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9saW5lQ291bnQrK1xuXG4gICAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGxpbmVcbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlICdxdW90ZWQtcHJpbnRhYmxlJzoge1xuICAgICAgICAgIGxldCBjdXJMaW5lID0gdGhpcy5fbGluZVJlbWFpbmRlciArICh0aGlzLl9saW5lQ291bnQgPiAxID8gJ1xcbicgOiAnJykgKyBsaW5lXG4gICAgICAgICAgY29uc3QgbWF0Y2ggPSBjdXJMaW5lLm1hdGNoKC89W2EtZjAtOV17MCwxfSQvaSlcbiAgICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSBtYXRjaFswXVxuICAgICAgICAgICAgY3VyTGluZSA9IGN1ckxpbmUuc3Vic3RyKDAsIGN1ckxpbmUubGVuZ3RoIC0gdGhpcy5fbGluZVJlbWFpbmRlci5sZW5ndGgpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2xpbmVSZW1haW5kZXIgPSAnJ1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9IGN1ckxpbmVcbiAgICAgICAgICBicmVha1xuICAgICAgICB9XG4gICAgICAgIGNhc2UgJzdiaXQnOlxuICAgICAgICBjYXNlICc4Yml0JzpcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICB0aGlzLl9ib2R5QnVmZmVyICs9ICh0aGlzLl9saW5lQ291bnQgPiAxID8gJ1xcbicgOiAnJykgKyBsaW5lXG4gICAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjaHVuayBvZiB0aGUgYm9keVxuICAqL1xuICBfZW1pdEJvZHkgKCkge1xuICAgIHRoaXMuX2RlY29kZUJvZHlCdWZmZXIoKVxuICAgIGlmICh0aGlzLl9pc011bHRpcGFydCB8fCAhdGhpcy5fYm9keUJ1ZmZlcikge1xuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdGhpcy5fcHJvY2Vzc0Zsb3dlZFRleHQoKVxuICAgIHRoaXMuY29udGVudCA9IHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICB0aGlzLl9wcm9jZXNzSHRtbFRleHQoKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJ1xuICB9XG5cbiAgX3Byb2Nlc3NGbG93ZWRUZXh0ICgpIHtcbiAgICBjb25zdCBpc1RleHQgPSAvXnRleHRcXC8ocGxhaW58aHRtbCkkL2kudGVzdCh0aGlzLmNvbnRlbnRUeXBlLnZhbHVlKVxuICAgIGNvbnN0IGlzRmxvd2VkID0gL15mbG93ZWQkL2kudGVzdChwYXRoT3IoJycsIFsnY29udGVudFR5cGUnLCAncGFyYW1zJywgJ2Zvcm1hdCddKSh0aGlzKSlcbiAgICBpZiAoIWlzVGV4dCB8fCAhaXNGbG93ZWQpIHJldHVyblxuXG4gICAgY29uc3QgZGVsU3AgPSAvXnllcyQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUucGFyYW1zLmRlbHNwKVxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSB0aGlzLl9ib2R5QnVmZmVyLnNwbGl0KCdcXG4nKVxuICAgICAgLnJlZHVjZShmdW5jdGlvbiAocHJldmlvdXNWYWx1ZSwgY3VycmVudFZhbHVlKSB7XG4gICAgICAgIC8vIHJlbW92ZSBzb2Z0IGxpbmVicmVha3MgYWZ0ZXIgc3BhY2Ugc3ltYm9scy5cbiAgICAgICAgLy8gZGVsc3AgYWRkcyBzcGFjZXMgdG8gdGV4dCB0byBiZSBhYmxlIHRvIGZvbGQgaXQuXG4gICAgICAgIC8vIHRoZXNlIHNwYWNlcyBjYW4gYmUgcmVtb3ZlZCBvbmNlIHRoZSB0ZXh0IGlzIHVuZm9sZGVkXG4gICAgICAgIGNvbnN0IGVuZHNXaXRoU3BhY2UgPSAvICQvLnRlc3QocHJldmlvdXNWYWx1ZSlcbiAgICAgICAgY29uc3QgaXNCb3VuZGFyeSA9IC8oXnxcXG4pLS0gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICByZXR1cm4gKGRlbFNwID8gcHJldmlvdXNWYWx1ZS5yZXBsYWNlKC9bIF0rJC8sICcnKSA6IHByZXZpb3VzVmFsdWUpICsgKChlbmRzV2l0aFNwYWNlICYmICFpc0JvdW5kYXJ5KSA/ICcnIDogJ1xcbicpICsgY3VycmVudFZhbHVlXG4gICAgICB9KVxuICAgICAgLnJlcGxhY2UoL14gL2dtLCAnJykgLy8gcmVtb3ZlIHdoaXRlc3BhY2Ugc3R1ZmZpbmcgaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzY3NiNzZWN0aW9uLTQuNFxuICB9XG5cbiAgX3Byb2Nlc3NIdG1sVGV4dCAoKSB7XG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gKHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddICYmIHRoaXMuaGVhZGVyc1snY29udGVudC1kaXNwb3NpdGlvbiddWzBdKSB8fCBwYXJzZUhlYWRlclZhbHVlKCcnKVxuICAgIGNvbnN0IGlzSHRtbCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNBdHRhY2htZW50ID0gL15hdHRhY2htZW50JC9pLnRlc3QoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlKVxuICAgIGlmIChpc0h0bWwgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgaWYgKCF0aGlzLmNoYXJzZXQgJiYgL150ZXh0XFwvaHRtbCQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuZGV0ZWN0SFRNTENoYXJzZXQodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gZGVjb2RlIFwiYmluYXJ5XCIgc3RyaW5nIHRvIGFuIHVuaWNvZGUgc3RyaW5nXG4gICAgICBpZiAoIS9edXRmWy1fXT84JC9pLnRlc3QodGhpcy5jaGFyc2V0KSkge1xuICAgICAgICB0aGlzLmNvbnRlbnQgPSBjb252ZXJ0KHN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlciksIHRoaXMuY2hhcnNldCB8fCAnaXNvLTg4NTktMScpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUgPT09ICdiYXNlNjQnKSB7XG4gICAgICAgIHRoaXMuY29udGVudCA9IHV0ZjhTdHIyYXJyKHRoaXMuX2JvZHlCdWZmZXIpXG4gICAgICB9XG5cbiAgICAgIC8vIG92ZXJyaWRlIGNoYXJzZXQgZm9yIHRleHQgbm9kZXNcbiAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgPSAndXRmLTgnXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERldGVjdCBjaGFyc2V0IGZyb20gYSBodG1sIGZpbGVcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGh0bWwgSW5wdXQgSFRNTFxuICAgKiBAcmV0dXJucyB7U3RyaW5nfSBDaGFyc2V0IGlmIGZvdW5kIG9yIHVuZGVmaW5lZFxuICAgKi9cbiAgZGV0ZWN0SFRNTENoYXJzZXQgKGh0bWwpIHtcbiAgICBsZXQgY2hhcnNldCwgaW5wdXRcblxuICAgIGh0bWwgPSBodG1sLnJlcGxhY2UoL1xccj9cXG58XFxyL2csICcgJylcbiAgICBsZXQgbWV0YSA9IGh0bWwubWF0Y2goLzxtZXRhXFxzK2h0dHAtZXF1aXY9W1wiJ1xcc10qY29udGVudC10eXBlW14+XSo/Pi9pKVxuICAgIGlmIChtZXRhKSB7XG4gICAgICBpbnB1dCA9IG1ldGFbMF1cbiAgICB9XG5cbiAgICBpZiAoaW5wdXQpIHtcbiAgICAgIGNoYXJzZXQgPSBpbnB1dC5tYXRjaCgvY2hhcnNldFxccz89XFxzPyhbYS16QS1aXFwtXzowLTldKik7Py8pXG4gICAgICBpZiAoY2hhcnNldCkge1xuICAgICAgICBjaGFyc2V0ID0gKGNoYXJzZXRbMV0gfHwgJycpLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgbWV0YSA9IGh0bWwubWF0Y2goLzxtZXRhXFxzK2NoYXJzZXQ9W1wiJ1xcc10qKFteXCInPD4vXFxzXSspL2kpXG4gICAgaWYgKCFjaGFyc2V0ICYmIG1ldGEpIHtcbiAgICAgIGNoYXJzZXQgPSAobWV0YVsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhcnNldFxuICB9XG59XG5cbmNvbnN0IHN0cjJhcnIgPSBzdHIgPT4gbmV3IFVpbnQ4QXJyYXkoc3RyLnNwbGl0KCcnKS5tYXAoY2hhciA9PiBjaGFyLmNoYXJDb2RlQXQoMCkpKVxuY29uc3QgdXRmOFN0cjJhcnIgPSBzdHIgPT4gbmV3IFRleHRFbmNvZGVyKCd1dGYtOCcpLmVuY29kZShzdHIpXG4iXX0=
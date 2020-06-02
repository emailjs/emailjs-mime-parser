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

function parse(chunk) {
  var root = new MimeNode(new NodeCounter());
  var str = typeof chunk === 'string' ? chunk : String.fromCharCode.apply(null, chunk);
  var line = '';
  var terminator = '';
  for (var i = 0; i < str.length; i += 1) {
    var char = str[i];
    if (char === '\r' || char === '\n') {
      var nextChar = str[i + 1];
      terminator += char;
      // Detect Windows and Macintosh line terminators.
      if (terminator + nextChar === '\r\n' || terminator + nextChar === '\n\r') {
        root.writeLine(line, terminator + nextChar);
        line = '';
        terminator = '';
        i += 1;
        // Detect single-character terminators, like Linux or other system.
      } else if (terminator === '\n' || terminator === '\r') {
        root.writeLine(line, terminator);
        line = '';
        terminator = '';
      }
    } else {
      line += char;
    }
  }
  // Flush the line and terminator values if necessary; handle edge cases where MIME is generated without last line terminator.
  if (line !== '' || terminator !== '') {
    root.writeLine(line, terminator);
  }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taW1lcGFyc2VyLmpzIl0sIm5hbWVzIjpbInBhcnNlIiwiTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUyIsIk5vZGVDb3VudGVyIiwiY291bnQiLCJFcnJvciIsImNodW5rIiwicm9vdCIsIk1pbWVOb2RlIiwic3RyIiwiU3RyaW5nIiwiZnJvbUNoYXJDb2RlIiwiYXBwbHkiLCJsaW5lIiwidGVybWluYXRvciIsImkiLCJsZW5ndGgiLCJjaGFyIiwibmV4dENoYXIiLCJ3cml0ZUxpbmUiLCJmaW5hbGl6ZSIsIm5vZGVDb3VudGVyIiwiYnVtcCIsImhlYWRlciIsImhlYWRlcnMiLCJib2R5c3RydWN0dXJlIiwiY2hpbGROb2RlcyIsInJhdyIsIl9zdGF0ZSIsIl9ib2R5QnVmZmVyIiwiX2xpbmVDb3VudCIsIl9jdXJyZW50Q2hpbGQiLCJfbGluZVJlbWFpbmRlciIsIl9pc011bHRpcGFydCIsIl9tdWx0aXBhcnRCb3VuZGFyeSIsIl9pc1JmYzgyMiIsIl9wcm9jZXNzSGVhZGVyTGluZSIsIl9wcm9jZXNzQm9keUxpbmUiLCJfZW1pdEJvZHkiLCJyZWR1Y2UiLCJhZ2ciLCJjaGlsZCIsImpvaW4iLCJjb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInZhbHVlIiwiY2hhcnNldCIsInJlcGxhY2UiLCJtIiwiY29kZSIsInBhcnNlSW50IiwiX3BhcnNlSGVhZGVycyIsIm1hdGNoIiwicHVzaCIsImhhc0JpbmFyeSIsImxlbiIsInNwbGl0Iiwia2V5Iiwic2hpZnQiLCJ0cmltIiwidG9Mb3dlckNhc2UiLCJzdHIyYXJyIiwiY29uY2F0IiwiX3BhcnNlSGVhZGVyVmFsdWUiLCJwYXJhbXMiLCJmZXRjaENvbnRlbnRUeXBlIiwiX3Byb2Nlc3NDb250ZW50VHJhbnNmZXJFbmNvZGluZyIsInBhcnNlZFZhbHVlIiwiaXNBZGRyZXNzIiwiX3BhcnNlRGF0ZSIsImluaXRpYWwiLCJfZGVjb2RlSGVhZGVyQ2hhcnNldCIsImRhdGUiLCJEYXRlIiwidGltZXpvbmUiLCJ0eiIsInRvVXBwZXJDYXNlIiwidG9TdHJpbmciLCJ0b1VUQ1N0cmluZyIsInBhcnNlZCIsIk9iamVjdCIsImtleXMiLCJmb3JFYWNoIiwiQXJyYXkiLCJpc0FycmF5IiwiYWRkciIsIm5hbWUiLCJncm91cCIsImRlZmF1bHRWYWx1ZSIsImNvbnRlbnRUeXBlIiwidHlwZSIsImJvdW5kYXJ5IiwicG9wIiwiZGVmYXVsdENvbnRlbnREaXNwb3NpdGlvblZhbHVlIiwiY29udGVudERpc3Bvc2l0aW9uIiwiaXNBdHRhY2htZW50IiwiaXNJbmxpbmVBdHRhY2htZW50IiwiY3VyTGluZSIsInN1YnN0ciIsIl9kZWNvZGVCb2R5QnVmZmVyIiwiX3Byb2Nlc3NGbG93ZWRUZXh0IiwiY29udGVudCIsIl9wcm9jZXNzSHRtbFRleHQiLCJpc1RleHQiLCJ0ZXN0IiwiaXNGbG93ZWQiLCJkZWxTcCIsImRlbHNwIiwicHJldmlvdXNWYWx1ZSIsImN1cnJlbnRWYWx1ZSIsImVuZHNXaXRoU3BhY2UiLCJpc0JvdW5kYXJ5IiwiaXNIdG1sIiwiZGV0ZWN0SFRNTENoYXJzZXQiLCJ1dGY4U3RyMmFyciIsImh0bWwiLCJpbnB1dCIsIm1ldGEiLCJVaW50OEFycmF5IiwibWFwIiwiY2hhckNvZGVBdCIsIlRleHRFbmNvZGVyIiwiZW5jb2RlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7a0JBc0J3QkEsSzs7QUF0QnhCOztBQUNBOzs7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7Ozs7O0FBRUE7Ozs7QUFJQSxJQUFNQywrQkFBK0IsR0FBckM7O0lBQ2FDLFcsV0FBQUEsVztBQUNYLHlCQUFlO0FBQUE7O0FBQ2IsU0FBS0MsS0FBTCxHQUFhLENBQWI7QUFDRDs7OzsyQkFDTztBQUNOLFVBQUksRUFBRSxLQUFLQSxLQUFQLEdBQWVGLDRCQUFuQixFQUFpRDtBQUMvQyxjQUFNLElBQUlHLEtBQUosQ0FBVSx3Q0FBVixDQUFOO0FBQ0Q7QUFDRjs7Ozs7O0FBR1ksU0FBU0osS0FBVCxDQUFnQkssS0FBaEIsRUFBdUI7QUFDcEMsTUFB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Q29udGVudCI6WyJpbXBvcnQgeyBwYXRoT3IgfSBmcm9tICdyYW1kYSdcbmltcG9ydCB0aW1lem9uZSBmcm9tICcuL3RpbWV6b25lcydcbmltcG9ydCB7IGRlY29kZSwgYmFzZTY0RGVjb2RlLCBjb252ZXJ0LCBwYXJzZUhlYWRlclZhbHVlLCBtaW1lV29yZHNEZWNvZGUgfSBmcm9tICdlbWFpbGpzLW1pbWUtY29kZWMnXG5pbXBvcnQgeyBUZXh0RW5jb2RlciB9IGZyb20gJ3RleHQtZW5jb2RpbmcnXG5pbXBvcnQgcGFyc2VBZGRyZXNzIGZyb20gJ2VtYWlsanMtYWRkcmVzc3BhcnNlcidcblxuLypcbiAqIENvdW50cyBNSU1FIG5vZGVzIHRvIHByZXZlbnQgbWVtb3J5IGV4aGF1c3Rpb24gYXR0YWNrcyAoQ1dFLTQwMClcbiAqIHNlZTogaHR0cHM6Ly9zbnlrLmlvL3Z1bG4vbnBtOmVtYWlsanMtbWltZS1wYXJzZXI6MjAxODA2MjVcbiAqL1xuY29uc3QgTUFYSU1VTV9OVU1CRVJfT0ZfTUlNRV9OT0RFUyA9IDk5OVxuZXhwb3J0IGNsYXNzIE5vZGVDb3VudGVyIHtcbiAgY29uc3RydWN0b3IgKCkge1xuICAgIHRoaXMuY291bnQgPSAwXG4gIH1cbiAgYnVtcCAoKSB7XG4gICAgaWYgKCsrdGhpcy5jb3VudCA+IE1BWElNVU1fTlVNQkVSX09GX01JTUVfTk9ERVMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSBudW1iZXIgb2YgTUlNRSBub2RlcyBleGNlZWRlZCEnKVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiBwYXJzZSAoY2h1bmspIHtcbiAgY29uc3Qgcm9vdCA9IG5ldyBNaW1lTm9kZShuZXcgTm9kZUNvdW50ZXIoKSlcbiAgY29uc3Qgc3RyID0gdHlwZW9mIGNodW5rID09PSAnc3RyaW5nJyA/IGNodW5rIDogU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShudWxsLCBjaHVuaylcbiAgbGV0IGxpbmUgPSAnJ1xuICBsZXQgdGVybWluYXRvciA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgY29uc3QgY2hhciA9IHN0cltpXVxuICAgIGlmIChjaGFyID09PSAnXFxyJyB8fCBjaGFyID09PSAnXFxuJykge1xuICAgICAgY29uc3QgbmV4dENoYXIgPSBzdHJbaSArIDFdXG4gICAgICB0ZXJtaW5hdG9yICs9IGNoYXJcbiAgICAgIC8vIERldGVjdCBXaW5kb3dzIGFuZCBNYWNpbnRvc2ggbGluZSB0ZXJtaW5hdG9ycy5cbiAgICAgIGlmICgodGVybWluYXRvciArIG5leHRDaGFyKSA9PT0gJ1xcclxcbicgfHwgKHRlcm1pbmF0b3IgKyBuZXh0Q2hhcikgPT09ICdcXG5cXHInKSB7XG4gICAgICAgIHJvb3Qud3JpdGVMaW5lKGxpbmUsIHRlcm1pbmF0b3IgKyBuZXh0Q2hhcilcbiAgICAgICAgbGluZSA9ICcnXG4gICAgICAgIHRlcm1pbmF0b3IgPSAnJ1xuICAgICAgICBpICs9IDFcbiAgICAgIC8vIERldGVjdCBzaW5nbGUtY2hhcmFjdGVyIHRlcm1pbmF0b3JzLCBsaWtlIExpbnV4IG9yIG90aGVyIHN5c3RlbS5cbiAgICAgIH0gZWxzZSBpZiAodGVybWluYXRvciA9PT0gJ1xcbicgfHwgdGVybWluYXRvciA9PT0gJ1xccicpIHtcbiAgICAgICAgcm9vdC53cml0ZUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgICAgICAgbGluZSA9ICcnXG4gICAgICAgIHRlcm1pbmF0b3IgPSAnJ1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lICs9IGNoYXJcbiAgICB9XG4gIH1cbiAgLy8gRmx1c2ggdGhlIGxpbmUgYW5kIHRlcm1pbmF0b3IgdmFsdWVzIGlmIG5lY2Vzc2FyeTsgaGFuZGxlIGVkZ2UgY2FzZXMgd2hlcmUgTUlNRSBpcyBnZW5lcmF0ZWQgd2l0aG91dCBsYXN0IGxpbmUgdGVybWluYXRvci5cbiAgaWYgKGxpbmUgIT09ICcnIHx8IHRlcm1pbmF0b3IgIT09ICcnKSB7XG4gICAgcm9vdC53cml0ZUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgfVxuICByb290LmZpbmFsaXplKClcbiAgcmV0dXJuIHJvb3Rcbn1cblxuZXhwb3J0IGNsYXNzIE1pbWVOb2RlIHtcbiAgY29uc3RydWN0b3IgKG5vZGVDb3VudGVyID0gbmV3IE5vZGVDb3VudGVyKCkpIHtcbiAgICB0aGlzLm5vZGVDb3VudGVyID0gbm9kZUNvdW50ZXJcbiAgICB0aGlzLm5vZGVDb3VudGVyLmJ1bXAoKVxuXG4gICAgdGhpcy5oZWFkZXIgPSBbXSAvLyBBbiBhcnJheSBvZiB1bmZvbGRlZCBoZWFkZXIgbGluZXNcbiAgICB0aGlzLmhlYWRlcnMgPSB7fSAvLyBBbiBvYmplY3QgdGhhdCBob2xkcyBoZWFkZXIga2V5PXZhbHVlIHBhaXJzXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gJydcbiAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXSAvLyBJZiB0aGlzIGlzIGEgbXVsdGlwYXJ0IG9yIG1lc3NhZ2UvcmZjODIyIG1pbWUgcGFydCwgdGhlIHZhbHVlIHdpbGwgYmUgY29udmVydGVkIHRvIGFycmF5IGFuZCBob2xkIGFsbCBjaGlsZCBub2RlcyBmb3IgdGhpcyBub2RlXG4gICAgdGhpcy5yYXcgPSAnJyAvLyBTdG9yZXMgdGhlIHJhdyBjb250ZW50IG9mIHRoaXMgbm9kZVxuXG4gICAgdGhpcy5fc3RhdGUgPSAnSEVBREVSJyAvLyBDdXJyZW50IHN0YXRlLCBhbHdheXMgc3RhcnRzIG91dCB3aXRoIEhFQURFUlxuICAgIHRoaXMuX2JvZHlCdWZmZXIgPSAnJyAvLyBCb2R5IGJ1ZmZlclxuICAgIHRoaXMuX2xpbmVDb3VudCA9IDAgLy8gTGluZSBjb3VudGVyIGJvciB0aGUgYm9keSBwYXJ0XG4gICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2UgLy8gQWN0aXZlIGNoaWxkIG5vZGUgKGlmIGF2YWlsYWJsZSlcbiAgICB0aGlzLl9saW5lUmVtYWluZGVyID0gJycgLy8gUmVtYWluZGVyIHN0cmluZyB3aGVuIGRlYWxpbmcgd2l0aCBiYXNlNjQgYW5kIHFwIHZhbHVlc1xuICAgIHRoaXMuX2lzTXVsdGlwYXJ0ID0gZmFsc2UgLy8gSW5kaWNhdGVzIGlmIHRoaXMgaXMgYSBtdWx0aXBhcnQgbm9kZVxuICAgIHRoaXMuX211bHRpcGFydEJvdW5kYXJ5ID0gZmFsc2UgLy8gU3RvcmVzIGJvdW5kYXJ5IHZhbHVlIGZvciBjdXJyZW50IG11bHRpcGFydCBub2RlXG4gICAgdGhpcy5faXNSZmM4MjIgPSBmYWxzZSAvLyBJbmRpY2F0ZXMgaWYgdGhpcyBpcyBhIG1lc3NhZ2UvcmZjODIyIG5vZGVcbiAgfVxuXG4gIHdyaXRlTGluZSAobGluZSwgdGVybWluYXRvcikge1xuICAgIHRoaXMucmF3ICs9IGxpbmUgKyAodGVybWluYXRvciB8fCAnXFxuJylcblxuICAgIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0hFQURFUicpIHtcbiAgICAgIHRoaXMuX3Byb2Nlc3NIZWFkZXJMaW5lKGxpbmUpXG4gICAgfSBlbHNlIGlmICh0aGlzLl9zdGF0ZSA9PT0gJ0JPRFknKSB7XG4gICAgICB0aGlzLl9wcm9jZXNzQm9keUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgICB9XG4gIH1cblxuICBmaW5hbGl6ZSAoKSB7XG4gICAgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQuZmluYWxpemUoKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9lbWl0Qm9keSgpXG4gICAgfVxuXG4gICAgdGhpcy5ib2R5c3RydWN0dXJlID0gdGhpcy5jaGlsZE5vZGVzXG4gICAgICAucmVkdWNlKChhZ2csIGNoaWxkKSA9PiBhZ2cgKyAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnXFxuJyArIGNoaWxkLmJvZHlzdHJ1Y3R1cmUsIHRoaXMuaGVhZGVyLmpvaW4oJ1xcbicpICsgJ1xcblxcbicpICtcbiAgICAgICh0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA/ICctLScgKyB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSArICctLVxcbicgOiAnJylcbiAgfVxuXG4gIF9kZWNvZGVCb2R5QnVmZmVyICgpIHtcbiAgICBzd2l0Y2ggKHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcudmFsdWUpIHtcbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgPSBiYXNlNjREZWNvZGUodGhpcy5fYm9keUJ1ZmZlciwgdGhpcy5jaGFyc2V0KVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAncXVvdGVkLXByaW50YWJsZSc6IHtcbiAgICAgICAgdGhpcy5fYm9keUJ1ZmZlciA9IHRoaXMuX2JvZHlCdWZmZXJcbiAgICAgICAgICAucmVwbGFjZSgvPShcXHI/XFxufCQpL2csICcnKVxuICAgICAgICAgIC5yZXBsYWNlKC89KFthLWYwLTldezJ9KS9pZywgKG0sIGNvZGUpID0+IFN0cmluZy5mcm9tQ2hhckNvZGUocGFyc2VJbnQoY29kZSwgMTYpKSlcbiAgICAgICAgYnJlYWtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIGEgbGluZSBpbiB0aGUgSEVBREVSIHN0YXRlLiBJdCB0aGUgbGluZSBpcyBlbXB0eSwgY2hhbmdlIHN0YXRlIHRvIEJPRFlcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGxpbmUgRW50aXJlIGlucHV0IGxpbmUgYXMgJ2JpbmFyeScgc3RyaW5nXG4gICAqL1xuICBfcHJvY2Vzc0hlYWRlckxpbmUgKGxpbmUpIHtcbiAgICBpZiAoIWxpbmUpIHtcbiAgICAgIHRoaXMuX3BhcnNlSGVhZGVycygpXG4gICAgICB0aGlzLmJvZHlzdHJ1Y3R1cmUgKz0gdGhpcy5oZWFkZXIuam9pbignXFxuJykgKyAnXFxuXFxuJ1xuICAgICAgdGhpcy5fc3RhdGUgPSAnQk9EWSdcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmIChsaW5lLm1hdGNoKC9eXFxzLykgJiYgdGhpcy5oZWFkZXIubGVuZ3RoKSB7XG4gICAgICB0aGlzLmhlYWRlclt0aGlzLmhlYWRlci5sZW5ndGggLSAxXSArPSAnXFxuJyArIGxpbmVcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5oZWFkZXIucHVzaChsaW5lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBKb2lucyBmb2xkZWQgaGVhZGVyIGxpbmVzIGFuZCBjYWxscyBDb250ZW50LVR5cGUgYW5kIFRyYW5zZmVyLUVuY29kaW5nIHByb2Nlc3NvcnNcbiAgICovXG4gIF9wYXJzZUhlYWRlcnMgKCkge1xuICAgIGZvciAobGV0IGhhc0JpbmFyeSA9IGZhbHNlLCBpID0gMCwgbGVuID0gdGhpcy5oZWFkZXIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGxldCB2YWx1ZSA9IHRoaXMuaGVhZGVyW2ldLnNwbGl0KCc6JylcbiAgICAgIGNvbnN0IGtleSA9ICh2YWx1ZS5zaGlmdCgpIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgICAgdmFsdWUgPSAodmFsdWUuam9pbignOicpIHx8ICcnKS5yZXBsYWNlKC9cXG4vZywgJycpLnRyaW0oKVxuXG4gICAgICBpZiAodmFsdWUubWF0Y2goL1tcXHUwMDgwLVxcdUZGRkZdLykpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNoYXJzZXQpIHtcbiAgICAgICAgICBoYXNCaW5hcnkgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgLy8gdXNlIGRlZmF1bHQgY2hhcnNldCBhdCBmaXJzdCBhbmQgaWYgdGhlIGFjdHVhbCBjaGFyc2V0IGlzIHJlc29sdmVkLCB0aGUgY29udmVyc2lvbiBpcyByZS1ydW5cbiAgICAgICAgdmFsdWUgPSBkZWNvZGUoY29udmVydChzdHIyYXJyKHZhbHVlKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJykpXG4gICAgICB9XG5cbiAgICAgIHRoaXMuaGVhZGVyc1trZXldID0gKHRoaXMuaGVhZGVyc1trZXldIHx8IFtdKS5jb25jYXQoW3RoaXMuX3BhcnNlSGVhZGVyVmFsdWUoa2V5LCB2YWx1ZSldKVxuXG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiBrZXkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgIHRoaXMuY2hhcnNldCA9IHRoaXMuaGVhZGVyc1trZXldW3RoaXMuaGVhZGVyc1trZXldLmxlbmd0aCAtIDFdLnBhcmFtcy5jaGFyc2V0XG4gICAgICB9XG5cbiAgICAgIGlmIChoYXNCaW5hcnkgJiYgdGhpcy5jaGFyc2V0KSB7XG4gICAgICAgIC8vIHJlc2V0IHZhbHVlcyBhbmQgc3RhcnQgb3ZlciBvbmNlIGNoYXJzZXQgaGFzIGJlZW4gcmVzb2x2ZWQgYW5kIDhiaXQgY29udGVudCBoYXMgYmVlbiBmb3VuZFxuICAgICAgICBoYXNCaW5hcnkgPSBmYWxzZVxuICAgICAgICB0aGlzLmhlYWRlcnMgPSB7fVxuICAgICAgICBpID0gLTEgLy8gbmV4dCBpdGVyYXRpb24gaGFzIGkgPT0gMFxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZmV0Y2hDb250ZW50VHlwZSgpXG4gICAgdGhpcy5fcHJvY2Vzc0NvbnRlbnRUcmFuc2ZlckVuY29kaW5nKClcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgc2luZ2xlIGhlYWRlciB2YWx1ZVxuICAgKiBAcGFyYW0ge1N0cmluZ30ga2V5IEhlYWRlciBrZXlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlIFZhbHVlIGZvciB0aGUga2V5XG4gICAqIEByZXR1cm4ge09iamVjdH0gcGFyc2VkIGhlYWRlclxuICAgKi9cbiAgX3BhcnNlSGVhZGVyVmFsdWUgKGtleSwgdmFsdWUpIHtcbiAgICBsZXQgcGFyc2VkVmFsdWVcbiAgICBsZXQgaXNBZGRyZXNzID0gZmFsc2VcblxuICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICBjYXNlICdjb250ZW50LXR5cGUnOlxuICAgICAgY2FzZSAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZyc6XG4gICAgICBjYXNlICdjb250ZW50LWRpc3Bvc2l0aW9uJzpcbiAgICAgIGNhc2UgJ2RraW0tc2lnbmF0dXJlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSBwYXJzZUhlYWRlclZhbHVlKHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAnZnJvbSc6XG4gICAgICBjYXNlICdzZW5kZXInOlxuICAgICAgY2FzZSAndG8nOlxuICAgICAgY2FzZSAncmVwbHktdG8nOlxuICAgICAgY2FzZSAnY2MnOlxuICAgICAgY2FzZSAnYmNjJzpcbiAgICAgIGNhc2UgJ2FidXNlLXJlcG9ydHMtdG8nOlxuICAgICAgY2FzZSAnZXJyb3JzLXRvJzpcbiAgICAgIGNhc2UgJ3JldHVybi1wYXRoJzpcbiAgICAgIGNhc2UgJ2RlbGl2ZXJlZC10byc6XG4gICAgICAgIGlzQWRkcmVzcyA9IHRydWVcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IFtdLmNvbmNhdChwYXJzZUFkZHJlc3ModmFsdWUpIHx8IFtdKVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdkYXRlJzpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHRoaXMuX3BhcnNlRGF0ZSh2YWx1ZSlcbiAgICAgICAgfVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcGFyc2VkVmFsdWUgPSB7XG4gICAgICAgICAgdmFsdWU6IHZhbHVlXG4gICAgICAgIH1cbiAgICB9XG4gICAgcGFyc2VkVmFsdWUuaW5pdGlhbCA9IHZhbHVlXG5cbiAgICB0aGlzLl9kZWNvZGVIZWFkZXJDaGFyc2V0KHBhcnNlZFZhbHVlLCB7IGlzQWRkcmVzcyB9KVxuXG4gICAgcmV0dXJuIHBhcnNlZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgZGF0ZSBzdHJpbmcgY2FuIGJlIHBhcnNlZC4gRmFsbHMgYmFjayByZXBsYWNpbmcgdGltZXpvbmVcbiAgICogYWJicmV2YXRpb25zIHdpdGggdGltZXpvbmUgdmFsdWVzLiBCb2d1cyB0aW1lem9uZXMgZGVmYXVsdCB0byBVVEMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgRGF0ZSBoZWFkZXJcbiAgICogQHJldHVybnMge1N0cmluZ30gVVRDIGRhdGUgc3RyaW5nIGlmIHBhcnNpbmcgc3VjY2VlZGVkLCBvdGhlcndpc2UgcmV0dXJucyBpbnB1dCB2YWx1ZVxuICAgKi9cbiAgX3BhcnNlRGF0ZSAoc3RyID0gJycpIHtcbiAgICBjb25zdCBkYXRlID0gbmV3IERhdGUoc3RyLnRyaW0oKS5yZXBsYWNlKC9cXGJbYS16XSskL2ksIHR6ID0+IHRpbWV6b25lW3R6LnRvVXBwZXJDYXNlKCldIHx8ICcrMDAwMCcpKVxuICAgIHJldHVybiAoZGF0ZS50b1N0cmluZygpICE9PSAnSW52YWxpZCBEYXRlJykgPyBkYXRlLnRvVVRDU3RyaW5nKCkucmVwbGFjZSgvR01ULywgJyswMDAwJykgOiBzdHJcbiAgfVxuXG4gIF9kZWNvZGVIZWFkZXJDaGFyc2V0IChwYXJzZWQsIHsgaXNBZGRyZXNzIH0gPSB7fSkge1xuICAgIC8vIGRlY29kZSBkZWZhdWx0IHZhbHVlXG4gICAgaWYgKHR5cGVvZiBwYXJzZWQudmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBwYXJzZWQudmFsdWUgPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnZhbHVlKVxuICAgIH1cblxuICAgIC8vIGRlY29kZSBwb3NzaWJsZSBwYXJhbXNcbiAgICBPYmplY3Qua2V5cyhwYXJzZWQucGFyYW1zIHx8IHt9KS5mb3JFYWNoKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLnBhcmFtc1trZXldID09PSAnc3RyaW5nJykge1xuICAgICAgICBwYXJzZWQucGFyYW1zW2tleV0gPSBtaW1lV29yZHNEZWNvZGUocGFyc2VkLnBhcmFtc1trZXldKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICAvLyBkZWNvZGUgYWRkcmVzc2VzXG4gICAgaWYgKGlzQWRkcmVzcyAmJiBBcnJheS5pc0FycmF5KHBhcnNlZC52YWx1ZSkpIHtcbiAgICAgIHBhcnNlZC52YWx1ZS5mb3JFYWNoKGFkZHIgPT4ge1xuICAgICAgICBpZiAoYWRkci5uYW1lKSB7XG4gICAgICAgICAgYWRkci5uYW1lID0gbWltZVdvcmRzRGVjb2RlKGFkZHIubmFtZSlcbiAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShhZGRyLmdyb3VwKSkge1xuICAgICAgICAgICAgdGhpcy5fZGVjb2RlSGVhZGVyQ2hhcnNldCh7IHZhbHVlOiBhZGRyLmdyb3VwIH0sIHsgaXNBZGRyZXNzOiB0cnVlIH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQYXJzZXMgQ29udGVudC1UeXBlIHZhbHVlIGFuZCBzZWxlY3RzIGZvbGxvd2luZyBhY3Rpb25zLlxuICAgKi9cbiAgZmV0Y2hDb250ZW50VHlwZSAoKSB7XG4gICAgY29uc3QgZGVmYXVsdFZhbHVlID0gcGFyc2VIZWFkZXJWYWx1ZSgndGV4dC9wbGFpbicpXG4gICAgdGhpcy5jb250ZW50VHlwZSA9IHBhdGhPcihkZWZhdWx0VmFsdWUsIFsnaGVhZGVycycsICdjb250ZW50LXR5cGUnLCAnMCddKSh0aGlzKVxuICAgIHRoaXMuY29udGVudFR5cGUudmFsdWUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZSB8fCAnJykudG9Mb3dlckNhc2UoKS50cmltKClcbiAgICB0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnNoaWZ0KCkgfHwgJ3RleHQnKVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUucGFyYW1zICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmNoYXJzZXQgJiYgIXRoaXMuY2hhcnNldCkge1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldFxuICAgIH1cblxuICAgIGlmICh0aGlzLmNvbnRlbnRUeXBlLnR5cGUgPT09ICdtdWx0aXBhcnQnICYmIHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5KSB7XG4gICAgICB0aGlzLmNoaWxkTm9kZXMgPSBbXVxuICAgICAgdGhpcy5faXNNdWx0aXBhcnQgPSAodGhpcy5jb250ZW50VHlwZS52YWx1ZS5zcGxpdCgnLycpLnBvcCgpIHx8ICdtaXhlZCcpXG4gICAgICB0aGlzLl9tdWx0aXBhcnRCb3VuZGFyeSA9IHRoaXMuY29udGVudFR5cGUucGFyYW1zLmJvdW5kYXJ5XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogRm9yIGF0dGFjaG1lbnQgKGlubGluZS9yZWd1bGFyKSBpZiBjaGFyc2V0IGlzIG5vdCBkZWZpbmVkIGFuZCBhdHRhY2htZW50IGlzIG5vbi10ZXh0LyosXG4gICAgICogdGhlbiBkZWZhdWx0IGNoYXJzZXQgdG8gYmluYXJ5LlxuICAgICAqIFJlZmVyIHRvIGlzc3VlOiBodHRwczovL2dpdGh1Yi5jb20vZW1haWxqcy9lbWFpbGpzLW1pbWUtcGFyc2VyL2lzc3Vlcy8xOFxuICAgICAqL1xuICAgIGNvbnN0IGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgY29udGVudERpc3Bvc2l0aW9uID0gcGF0aE9yKGRlZmF1bHRDb250ZW50RGlzcG9zaXRpb25WYWx1ZSwgWydoZWFkZXJzJywgJ2NvbnRlbnQtZGlzcG9zaXRpb24nLCAnMCddKSh0aGlzKVxuICAgIGNvbnN0IGlzQXR0YWNobWVudCA9IChjb250ZW50RGlzcG9zaXRpb24udmFsdWUgfHwgJycpLnRvTG93ZXJDYXNlKCkudHJpbSgpID09PSAnYXR0YWNobWVudCdcbiAgICBjb25zdCBpc0lubGluZUF0dGFjaG1lbnQgPSAoY29udGVudERpc3Bvc2l0aW9uLnZhbHVlIHx8ICcnKS50b0xvd2VyQ2FzZSgpLnRyaW0oKSA9PT0gJ2lubGluZSdcbiAgICBpZiAoKGlzQXR0YWNobWVudCB8fCBpc0lubGluZUF0dGFjaG1lbnQpICYmIHRoaXMuY29udGVudFR5cGUudHlwZSAhPT0gJ3RleHQnICYmICF0aGlzLmNoYXJzZXQpIHtcbiAgICAgIHRoaXMuY2hhcnNldCA9ICdiaW5hcnknXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY29udGVudFR5cGUudmFsdWUgPT09ICdtZXNzYWdlL3JmYzgyMicgJiYgIWlzQXR0YWNobWVudCkge1xuICAgICAgLyoqXG4gICAgICAgKiBQYXJzZSBtZXNzYWdlL3JmYzgyMiBvbmx5IGlmIHRoZSBtaW1lIHBhcnQgaXMgbm90IG1hcmtlZCB3aXRoIGNvbnRlbnQtZGlzcG9zaXRpb246IGF0dGFjaG1lbnQsXG4gICAgICAgKiBvdGhlcndpc2UgdHJlYXQgaXQgbGlrZSBhIHJlZ3VsYXIgYXR0YWNobWVudFxuICAgICAgICovXG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcy5ub2RlQ291bnRlcilcbiAgICAgIHRoaXMuY2hpbGROb2RlcyA9IFt0aGlzLl9jdXJyZW50Q2hpbGRdXG4gICAgICB0aGlzLl9pc1JmYzgyMiA9IHRydWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2VzIENvbnRlbnQtVHJhbnNmZXItRW5jb2RpbmcgdmFsdWUgdG8gc2VlIGlmIHRoZSBib2R5IG5lZWRzIHRvIGJlIGNvbnZlcnRlZFxuICAgKiBiZWZvcmUgaXQgY2FuIGJlIGVtaXR0ZWRcbiAgICovXG4gIF9wcm9jZXNzQ29udGVudFRyYW5zZmVyRW5jb2RpbmcgKCkge1xuICAgIGNvbnN0IGRlZmF1bHRWYWx1ZSA9IHBhcnNlSGVhZGVyVmFsdWUoJzdiaXQnKVxuICAgIHRoaXMuY29udGVudFRyYW5zZmVyRW5jb2RpbmcgPSBwYXRoT3IoZGVmYXVsdFZhbHVlLCBbJ2hlYWRlcnMnLCAnY29udGVudC10cmFuc2Zlci1lbmNvZGluZycsICcwJ10pKHRoaXMpXG4gICAgdGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9IHBhdGhPcignJywgWydjb250ZW50VHJhbnNmZXJFbmNvZGluZycsICd2YWx1ZSddKSh0aGlzKS50b0xvd2VyQ2FzZSgpLnRyaW0oKVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyBhIGxpbmUgaW4gdGhlIEJPRFkgc3RhdGUuIElmIHRoaXMgaXMgYSBtdWx0aXBhcnQgb3IgcmZjODIyIG5vZGUsXG4gICAqIHBhc3NlcyBsaW5lIHZhbHVlIHRvIGNoaWxkIG5vZGVzLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbGluZSBFbnRpcmUgaW5wdXQgbGluZSBhcyAnYmluYXJ5JyBzdHJpbmdcbiAgICogQHBhcmFtIHtTdHJpbmd9IHRlcm1pbmF0b3IgVGhlIGxpbmUgdGVybWluYXRvciBkZXRlY3RlZCBieSBwYXJzZXJcbiAgICovXG4gIF9wcm9jZXNzQm9keUxpbmUgKGxpbmUsIHRlcm1pbmF0b3IpIHtcbiAgICBpZiAodGhpcy5faXNNdWx0aXBhcnQpIHtcbiAgICAgIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkpIHtcbiAgICAgICAgdGhpcy5ib2R5c3RydWN0dXJlICs9IGxpbmUgKyAnXFxuJ1xuICAgICAgICBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgICAgdGhpcy5fY3VycmVudENoaWxkLmZpbmFsaXplKClcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jdXJyZW50Q2hpbGQgPSBuZXcgTWltZU5vZGUodGhpcy5ub2RlQ291bnRlcilcbiAgICAgICAgdGhpcy5jaGlsZE5vZGVzLnB1c2godGhpcy5fY3VycmVudENoaWxkKVxuICAgICAgfSBlbHNlIGlmIChsaW5lID09PSAnLS0nICsgdGhpcy5fbXVsdGlwYXJ0Qm91bmRhcnkgKyAnLS0nKSB7XG4gICAgICAgIHRoaXMuYm9keXN0cnVjdHVyZSArPSBsaW5lICsgJ1xcbidcbiAgICAgICAgaWYgKHRoaXMuX2N1cnJlbnRDaGlsZCkge1xuICAgICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC5maW5hbGl6ZSgpXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY3VycmVudENoaWxkID0gZmFsc2VcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fY3VycmVudENoaWxkKSB7XG4gICAgICAgIHRoaXMuX2N1cnJlbnRDaGlsZC53cml0ZUxpbmUobGluZSwgdGVybWluYXRvcilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElnbm9yZSBtdWx0aXBhcnQgcHJlYW1ibGVcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuX2lzUmZjODIyKSB7XG4gICAgICB0aGlzLl9jdXJyZW50Q2hpbGQud3JpdGVMaW5lKGxpbmUsIHRlcm1pbmF0b3IpXG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2xpbmVDb3VudCsrXG5cbiAgICAgIHN3aXRjaCAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSkge1xuICAgICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gbGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgJ3F1b3RlZC1wcmludGFibGUnOiB7XG4gICAgICAgICAgbGV0IGN1ckxpbmUgPSB0aGlzLl9saW5lUmVtYWluZGVyICsgKHRoaXMuX2xpbmVDb3VudCA+IDEgPyAnXFxuJyA6ICcnKSArIGxpbmVcbiAgICAgICAgICBjb25zdCBtYXRjaCA9IGN1ckxpbmUubWF0Y2goLz1bYS1mMC05XXswLDF9JC9pKVxuICAgICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9IG1hdGNoWzBdXG4gICAgICAgICAgICBjdXJMaW5lID0gY3VyTGluZS5zdWJzdHIoMCwgY3VyTGluZS5sZW5ndGggLSB0aGlzLl9saW5lUmVtYWluZGVyLmxlbmd0aClcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fbGluZVJlbWFpbmRlciA9ICcnXG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gY3VyTGluZVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIH1cbiAgICAgICAgY2FzZSAnN2JpdCc6XG4gICAgICAgIGNhc2UgJzhiaXQnOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRoaXMuX2JvZHlCdWZmZXIgKz0gKHRoaXMuX2xpbmVDb3VudCA+IDEgPyAnXFxuJyA6ICcnKSArIGxpbmVcbiAgICAgICAgICBicmVha1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBFbWl0cyBhIGNodW5rIG9mIHRoZSBib2R5XG4gICovXG4gIF9lbWl0Qm9keSAoKSB7XG4gICAgdGhpcy5fZGVjb2RlQm9keUJ1ZmZlcigpXG4gICAgaWYgKHRoaXMuX2lzTXVsdGlwYXJ0IHx8ICF0aGlzLl9ib2R5QnVmZmVyKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICB0aGlzLl9wcm9jZXNzRmxvd2VkVGV4dCgpXG4gICAgdGhpcy5jb250ZW50ID0gc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKVxuICAgIHRoaXMuX3Byb2Nlc3NIdG1sVGV4dCgpXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9ICcnXG4gIH1cblxuICBfcHJvY2Vzc0Zsb3dlZFRleHQgKCkge1xuICAgIGNvbnN0IGlzVGV4dCA9IC9edGV4dFxcLyhwbGFpbnxodG1sKSQvaS50ZXN0KHRoaXMuY29udGVudFR5cGUudmFsdWUpXG4gICAgY29uc3QgaXNGbG93ZWQgPSAvXmZsb3dlZCQvaS50ZXN0KHBhdGhPcignJywgWydjb250ZW50VHlwZScsICdwYXJhbXMnLCAnZm9ybWF0J10pKHRoaXMpKVxuICAgIGlmICghaXNUZXh0IHx8ICFpc0Zsb3dlZCkgcmV0dXJuXG5cbiAgICBjb25zdCBkZWxTcCA9IC9eeWVzJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS5wYXJhbXMuZGVsc3ApXG4gICAgdGhpcy5fYm9keUJ1ZmZlciA9IHRoaXMuX2JvZHlCdWZmZXIuc3BsaXQoJ1xcbicpXG4gICAgICAucmVkdWNlKGZ1bmN0aW9uIChwcmV2aW91c1ZhbHVlLCBjdXJyZW50VmFsdWUpIHtcbiAgICAgICAgLy8gcmVtb3ZlIHNvZnQgbGluZWJyZWFrcyBhZnRlciBzcGFjZSBzeW1ib2xzLlxuICAgICAgICAvLyBkZWxzcCBhZGRzIHNwYWNlcyB0byB0ZXh0IHRvIGJlIGFibGUgdG8gZm9sZCBpdC5cbiAgICAgICAgLy8gdGhlc2Ugc3BhY2VzIGNhbiBiZSByZW1vdmVkIG9uY2UgdGhlIHRleHQgaXMgdW5mb2xkZWRcbiAgICAgICAgY29uc3QgZW5kc1dpdGhTcGFjZSA9IC8gJC8udGVzdChwcmV2aW91c1ZhbHVlKVxuICAgICAgICBjb25zdCBpc0JvdW5kYXJ5ID0gLyhefFxcbiktLSAkLy50ZXN0KHByZXZpb3VzVmFsdWUpXG4gICAgICAgIHJldHVybiAoZGVsU3AgPyBwcmV2aW91c1ZhbHVlLnJlcGxhY2UoL1sgXSskLywgJycpIDogcHJldmlvdXNWYWx1ZSkgKyAoKGVuZHNXaXRoU3BhY2UgJiYgIWlzQm91bmRhcnkpID8gJycgOiAnXFxuJykgKyBjdXJyZW50VmFsdWVcbiAgICAgIH0pXG4gICAgICAucmVwbGFjZSgvXiAvZ20sICcnKSAvLyByZW1vdmUgd2hpdGVzcGFjZSBzdHVmZmluZyBodHRwOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9yZmMzNjc2I3NlY3Rpb24tNC40XG4gIH1cblxuICBfcHJvY2Vzc0h0bWxUZXh0ICgpIHtcbiAgICBjb25zdCBjb250ZW50RGlzcG9zaXRpb24gPSAodGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ10gJiYgdGhpcy5oZWFkZXJzWydjb250ZW50LWRpc3Bvc2l0aW9uJ11bMF0pIHx8IHBhcnNlSGVhZGVyVmFsdWUoJycpXG4gICAgY29uc3QgaXNIdG1sID0gL150ZXh0XFwvKHBsYWlufGh0bWwpJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSlcbiAgICBjb25zdCBpc0F0dGFjaG1lbnQgPSAvXmF0dGFjaG1lbnQkL2kudGVzdChjb250ZW50RGlzcG9zaXRpb24udmFsdWUpXG4gICAgaWYgKGlzSHRtbCAmJiAhaXNBdHRhY2htZW50KSB7XG4gICAgICBpZiAoIXRoaXMuY2hhcnNldCAmJiAvXnRleHRcXC9odG1sJC9pLnRlc3QodGhpcy5jb250ZW50VHlwZS52YWx1ZSkpIHtcbiAgICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5kZXRlY3RIVE1MQ2hhcnNldCh0aGlzLl9ib2R5QnVmZmVyKVxuICAgICAgfVxuXG4gICAgICAvLyBkZWNvZGUgXCJiaW5hcnlcIiBzdHJpbmcgdG8gYW4gdW5pY29kZSBzdHJpbmdcbiAgICAgIGlmICghL151dGZbLV9dPzgkL2kudGVzdCh0aGlzLmNoYXJzZXQpKSB7XG4gICAgICAgIHRoaXMuY29udGVudCA9IGNvbnZlcnQoc3RyMmFycih0aGlzLl9ib2R5QnVmZmVyKSwgdGhpcy5jaGFyc2V0IHx8ICdpc28tODg1OS0xJylcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5jb250ZW50VHJhbnNmZXJFbmNvZGluZy52YWx1ZSA9PT0gJ2Jhc2U2NCcpIHtcbiAgICAgICAgdGhpcy5jb250ZW50ID0gdXRmOFN0cjJhcnIodGhpcy5fYm9keUJ1ZmZlcilcbiAgICAgIH1cblxuICAgICAgLy8gb3ZlcnJpZGUgY2hhcnNldCBmb3IgdGV4dCBub2Rlc1xuICAgICAgdGhpcy5jaGFyc2V0ID0gdGhpcy5jb250ZW50VHlwZS5wYXJhbXMuY2hhcnNldCA9ICd1dGYtOCdcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGV0ZWN0IGNoYXJzZXQgZnJvbSBhIGh0bWwgZmlsZVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaHRtbCBJbnB1dCBIVE1MXG4gICAqIEByZXR1cm5zIHtTdHJpbmd9IENoYXJzZXQgaWYgZm91bmQgb3IgdW5kZWZpbmVkXG4gICAqL1xuICBkZXRlY3RIVE1MQ2hhcnNldCAoaHRtbCkge1xuICAgIGxldCBjaGFyc2V0LCBpbnB1dFxuXG4gICAgaHRtbCA9IGh0bWwucmVwbGFjZSgvXFxyP1xcbnxcXHIvZywgJyAnKVxuICAgIGxldCBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMraHR0cC1lcXVpdj1bXCInXFxzXSpjb250ZW50LXR5cGVbXj5dKj8+L2kpXG4gICAgaWYgKG1ldGEpIHtcbiAgICAgIGlucHV0ID0gbWV0YVswXVxuICAgIH1cblxuICAgIGlmIChpbnB1dCkge1xuICAgICAgY2hhcnNldCA9IGlucHV0Lm1hdGNoKC9jaGFyc2V0XFxzPz1cXHM/KFthLXpBLVpcXC1fOjAtOV0qKTs/LylcbiAgICAgIGlmIChjaGFyc2V0KSB7XG4gICAgICAgIGNoYXJzZXQgPSAoY2hhcnNldFsxXSB8fCAnJykudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgICAgIH1cbiAgICB9XG5cbiAgICBtZXRhID0gaHRtbC5tYXRjaCgvPG1ldGFcXHMrY2hhcnNldD1bXCInXFxzXSooW15cIic8Pi9cXHNdKykvaSlcbiAgICBpZiAoIWNoYXJzZXQgJiYgbWV0YSkge1xuICAgICAgY2hhcnNldCA9IChtZXRhWzFdIHx8ICcnKS50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIH1cblxuICAgIHJldHVybiBjaGFyc2V0XG4gIH1cbn1cblxuY29uc3Qgc3RyMmFyciA9IHN0ciA9PiBuZXcgVWludDhBcnJheShzdHIuc3BsaXQoJycpLm1hcChjaGFyID0+IGNoYXIuY2hhckNvZGVBdCgwKSkpXG5jb25zdCB1dGY4U3RyMmFyciA9IHN0ciA9PiBuZXcgVGV4dEVuY29kZXIoJ3V0Zi04JykuZW5jb2RlKHN0cilcbiJdfQ==
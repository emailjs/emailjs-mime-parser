import timezone from './timezones'
import { decode, convert, parseHeaderValue, mimeWordsDecode } from 'emailjs-mime-codec'
import { decode as decodeBase64 } from 'emailjs-base64'
import parseAddress from 'emailjs-addressparser'

export default function MimeNode () {
  this.header = [] // An array of unfolded header lines
  this.headers = {} // An object that holds header key=value pairs
  this.bodystructure = ''
  this.childNodes = [] // If this is a multipart or message/rfc822 mime part, the value will be converted to array and hold all child nodes for this node
  this.raw = '' // Stores the raw content of this node

  // Private properties
  this._state = 'HEADER' // Current state, always starts out with HEADER
  this._bodyBuffer = '' // Body buffer
  this._lineCount = 0 // Line counter bor the body part
  this._currentChild = false // Active child node (if available)
  this._lineRemainder = '' // Remainder string when dealing with base64 and qp values
  this._isMultipart = false // Indicates if this is a multipart node
  this._multipartBoundary = false // Stores boundary value for current multipart node
  this._isRfc822 = false // Indicates if this is a message/rfc822 node
}

MimeNode.prototype.writeLine = function (line) {
  this.raw += (this.raw ? '\n' : '') + line

  if (this._state === 'HEADER') {
    this._processHeaderLine(line)
  } else if (this._state === 'BODY') {
    this._processBodyLine(line)
  }
}

MimeNode.prototype.finalize = function () {
  if (this._isRfc822) {
    this._currentChild.finalize()
  } else {
    this._emitBody()
  }
}

/**
 * Processes a line in the HEADER state. It the line is empty, change state to BODY
 *
 * @param {String} line Entire input line as 'binary' string
 */
MimeNode.prototype._processHeaderLine = function (line) {
  if (!line) {
    this._parseHeaders()
    this.bodystructure += this.header.join('\n') + '\n\n'
    this._state = 'BODY'
    return
  }

  if (line.match(/^\s/) && this.header.length) {
    this.header[this.header.length - 1] += '\n' + line
  } else {
    this.header.push(line)
  }
}

/**
 * Joins folded header lines and calls Content-Type and Transfer-Encoding processors
 */
MimeNode.prototype._parseHeaders = function () {
  // Join header lines
  var key, value, hasBinary

  for (var i = 0, len = this.header.length; i < len; i++) {
    value = this.header[i].split(':')
    key = (value.shift() || '').trim().toLowerCase()
    value = (value.join(':') || '').replace(/\n/g, '').trim()

    if (value.match(/[\u0080-\uFFFF]/)) {
      if (!this.charset) {
        hasBinary = true
      }
      // use default charset at first and if the actual charset is resolved, the conversion is re-run
      value = decode(convert(str2arr(value), this.charset || 'iso-8859-1'))
    }

    if (!this.headers[key]) {
      this.headers[key] = [this._parseHeaderValue(key, value)]
    } else {
      this.headers[key].push(this._parseHeaderValue(key, value))
    }

    if (!this.charset && key === 'content-type') {
      this.charset = this.headers[key][this.headers[key].length - 1].params.charset
    }

    if (hasBinary && this.charset) {
      // reset values and start over once charset has been resolved and 8bit content has been found
      hasBinary = false
      this.headers = {}
      i = -1 // next iteration has i == 0
    }
  }

  this._processContentType()
  this._processContentTransferEncoding()
}

/**
 * Parses single header value
 * @param {String} key Header key
 * @param {String} value Value for the key
 * @return {Object} parsed header
 */
MimeNode.prototype._parseHeaderValue = function (key, value) {
  let parsedValue
  let isAddress = false

  switch (key) {
    case 'content-type':
    case 'content-transfer-encoding':
    case 'content-disposition':
    case 'dkim-signature':
      parsedValue = parseHeaderValue(value)
      break
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
      isAddress = true
      parsedValue = {
        value: [].concat(parseAddress(value) || [])
      }
      break
    case 'date':
      parsedValue = {
        value: this._parseDate(value)
      }
      break
    default:
      parsedValue = {
        value: value
      }
  }
  parsedValue.initial = value

  this._decodeHeaderCharset(parsedValue, {
    isAddress: isAddress
  })

  return parsedValue
}

/**
 * Checks if a date string can be parsed. Falls back replacing timezone
 * abbrevations with timezone values
 *
 * @param {String} str Date header
 * @returns {String} UTC date string if parsing succeeded, otherwise returns input value
 */
MimeNode.prototype._parseDate = function (str) {
  str = (str || '').toString().trim()

  var date = new Date(str)

  if (this._isValidDate(date)) {
    return date.toUTCString().replace(/GMT/, '+0000')
  }

  // Assume last alpha part is a timezone
  // Ex: "Date: Thu, 15 May 2014 13:53:30 EEST"
  str = str.replace(/\b[a-z]+$/i, function (tz) {
    tz = tz.toUpperCase()
    if (timezone.hasOwnProperty(tz)) {
      return timezone[tz]
    }
    return tz
  })

  date = new Date(str)

  if (this._isValidDate(date)) {
    return date.toUTCString().replace(/GMT/, '+0000')
  } else {
    return str
  }
}

/**
 * Checks if a value is a Date object and it contains an actual date value
 * @param {Date} date Date object to check
 * @returns {Boolean} True if the value is a valid date
 */
MimeNode.prototype._isValidDate = function (date) {
  return Object.prototype.toString.call(date) === '[object Date]' && date.toString() !== 'Invalid Date'
}

MimeNode.prototype._decodeHeaderCharset = function (parsed, options) {
  options = options || {}

    // decode default value
  if (typeof parsed.value === 'string') {
    parsed.value = mimeWordsDecode(parsed.value)
  }

    // decode possible params
  Object.keys(parsed.params || {}).forEach(function (key) {
    if (typeof parsed.params[key] === 'string') {
      parsed.params[key] = mimeWordsDecode(parsed.params[key])
    }
  })

    // decode addresses
  if (options.isAddress && Array.isArray(parsed.value)) {
    parsed.value.forEach(function (addr) {
      if (addr.name) {
        addr.name = mimeWordsDecode(addr.name)
        if (Array.isArray(addr.group)) {
          this._decodeHeaderCharset({
            value: addr.group
          }, {
            isAddress: true
          })
        }
      }
    }.bind(this))
  }

  return parsed
}

/**
 * Parses Content-Type value and selects following actions.
 */
MimeNode.prototype._processContentType = function () {
  var contentDisposition

  this.contentType = (this.headers['content-type'] && this.headers['content-type'][0]) || parseHeaderValue('text/plain')
  this.contentType.value = (this.contentType.value || '').toLowerCase().trim()
  this.contentType.type = (this.contentType.value.split('/').shift() || 'text')

  if (this.contentType.params && this.contentType.params.charset && !this.charset) {
    this.charset = this.contentType.params.charset
  }

  if (this.contentType.type === 'multipart' && this.contentType.params.boundary) {
    this.childNodes = []
    this._isMultipart = (this.contentType.value.split('/').pop() || 'mixed')
    this._multipartBoundary = this.contentType.params.boundary
  }

  if (this.contentType.value === 'message/rfc822') {
    /**
     * Parse message/rfc822 only if the mime part is not marked with content-disposition: attachment,
     * otherwise treat it like a regular attachment
     */
    contentDisposition = (this.headers['content-disposition'] && this.headers['content-disposition'][0]) || parseHeaderValue('')
    if ((contentDisposition.value || '').toLowerCase().trim() !== 'attachment') {
      this.childNodes = []
      this._currentChild = new MimeNode(this)
      this.childNodes.push(this._currentChild)
      this._isRfc822 = true
    }
  }
}

/**
 * Parses Content-Transfer-Encoding value to see if the body needs to be converted
 * before it can be emitted
 */
MimeNode.prototype._processContentTransferEncoding = function () {
  this.contentTransferEncoding = (this.headers['content-transfer-encoding'] && this.headers['content-transfer-encoding'][0]) || parseHeaderValue('7bit')
  this.contentTransferEncoding.value = (this.contentTransferEncoding.value || '').toLowerCase().trim()
}

/**
 * Processes a line in the BODY state. If this is a multipart or rfc822 node,
 * passes line value to child nodes.
 *
 * @param {String} line Entire input line as 'binary' string
 */
MimeNode.prototype._processBodyLine = function (line) {
  var curLine, match

  this._lineCount++

  if (this._isMultipart) {
    if (line === '--' + this._multipartBoundary) {
      this.bodystructure += line + '\n'
      if (this._currentChild) {
        this._currentChild.finalize()
      }
      this._currentChild = new MimeNode(this)
      this.childNodes.push(this._currentChild)
    } else if (line === '--' + this._multipartBoundary + '--') {
      this.bodystructure += line + '\n'
      if (this._currentChild) {
        this._currentChild.finalize()
      }
      this._currentChild = false
    } else if (this._currentChild) {
      this._currentChild.writeLine(line)
    } else {
            // Ignore multipart preamble
    }
  } else if (this._isRfc822) {
    this._currentChild.writeLine(line)
  } else {
    switch (this.contentTransferEncoding.value) {
      case 'base64':
        curLine = this._lineRemainder + line.trim()

        if (curLine.length % 4) {
          this._lineRemainder = curLine.substr(-curLine.length % 4)
          curLine = curLine.substr(0, curLine.length - this._lineRemainder.length)
        } else {
          this._lineRemainder = ''
        }

        if (curLine.length) {
          this._bodyBuffer += decodeBase64(curLine)
        }

        break
      case 'quoted-printable':
        curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line

        if ((match = curLine.match(/=[a-f0-9]{0,1}$/i))) {
          this._lineRemainder = match[0]
          curLine = curLine.substr(0, curLine.length - this._lineRemainder.length)
        } else {
          this._lineRemainder = ''
        }

        this._bodyBuffer += curLine.replace(/=(\r?\n|$)/g, '').replace(/=([a-f0-9]{2})/ig, function (m, code) {
          return String.fromCharCode(parseInt(code, 16))
        })
        break
                // case '7bit':
                // case '8bit':
      default:
        this._bodyBuffer += (this._lineCount > 1 ? '\n' : '') + line
        break
    }
  }
}

/**
 * Emits a chunk of the body
 *
 * @param {Boolean} forceEmit If set to true does not keep any remainders
 */
MimeNode.prototype._emitBody = function () {
  var contentDisposition = (this.headers['content-disposition'] && this.headers['content-disposition'][0]) || parseHeaderValue('')
  var delSp

  if (this._isMultipart || !this._bodyBuffer) {
    return
  }

    // Process flowed text before emitting it
  if (/^text\/(plain|html)$/i.test(this.contentType.value) &&
        this.contentType.params && /^flowed$/i.test(this.contentType.params.format)) {
    delSp = /^yes$/i.test(this.contentType.params.delsp)

    this._bodyBuffer = this._bodyBuffer
        .split('\n')
        // remove soft linebreaks
        // soft linebreaks are added after space symbols
        .reduce(function (previousValue, currentValue) {
          var body = previousValue
          if (delSp) {
            // delsp adds spaces to text to be able to fold it
            // these spaces can be removed once the text is unfolded
            body = body.replace(/[ ]+$/, '')
          }
          if (/ $/.test(previousValue) && !/(^|\n)-- $/.test(previousValue)) {
            return body + currentValue
          } else {
            return body + '\n' + currentValue
          }
        })
        // remove whitespace stuffing
        // http://tools.ietf.org/html/rfc3676#section-4.4
        .replace(/^ /gm, '')
  }

  this.content = str2arr(this._bodyBuffer)

  if (/^text\/(plain|html)$/i.test(this.contentType.value) && !/^attachment$/i.test(contentDisposition.value)) {
    if (!this.charset && /^text\/html$/i.test(this.contentType.value)) {
      this.charset = this._detectHTMLCharset(this._bodyBuffer)
    }

    // decode "binary" string to an unicode string
    if (!/^utf[-_]?8$/i.test(this.charset)) {
      this.content = convert(str2arr(this._bodyBuffer), this.charset || 'iso-8859-1')
    }

    // override charset for text nodes
    this.charset = this.contentType.params.charset = 'utf-8'
  }
  this._bodyBuffer = ''
}

/**
 * Detect charset from a html file
 *
 * @param {String} html Input HTML
 * @returns {String} Charset if found or undefined
 */
MimeNode.prototype._detectHTMLCharset = function (html) {
  var charset, input, meta

  if (typeof html !== 'string') {
    html = html.toString('ascii')
  }

  html = html.replace(/\r?\n|\r/g, ' ')

  if ((meta = html.match(/<meta\s+http-equiv=["'\s]*content-type[^>]*?>/i))) {
    input = meta[0]
  }

  if (input) {
    charset = input.match(/charset\s?=\s?([a-zA-Z\-_:0-9]*);?/)
    if (charset) {
      charset = (charset[1] || '').trim().toLowerCase()
    }
  }

  if (!charset && (meta = html.match(/<meta\s+charset=["'\s]*([^"'<>/\s]+)/i))) {
    charset = (meta[1] || '').trim().toLowerCase()
  }

  return charset
}

const str2arr = str => new Uint8Array(str.split('').map(char => char.charCodeAt(0)))

import { pathOr } from 'ramda'
import timezone from './timezones'
import { decode, base64Decode, convert, parseHeaderValue, mimeWordsDecode } from 'emailjs-mime-codec'
import { TextEncoder } from 'text-encoding'
import parseAddress from 'emailjs-addressparser'

/*
 * Counts MIME nodes to prevent memory exhaustion attacks (CWE-400)
 * see: https://snyk.io/vuln/npm:emailjs-mime-parser:20180625
 */
const MAXIMUM_NUMBER_OF_MIME_NODES = 999
export class NodeCounter {
  constructor () {
    this.count = 0
  }
  bump () {
    if (++this.count > MAXIMUM_NUMBER_OF_MIME_NODES) {
      throw new Error('Maximum number of MIME nodes exceeded!')
    }
  }
}

export default function parse (chunk) {
  const root = new MimeNode(new NodeCounter())
  const lines = (typeof chunk === 'object' ? String.fromCharCode.apply(null, chunk) : chunk).split(/\r?\n/g)
  lines.forEach(line => root.writeLine(line))
  root.finalize()
  return root
}

export class MimeNode {
  constructor (nodeCounter = new NodeCounter()) {
    this.nodeCounter = nodeCounter
    this.nodeCounter.bump()

    this.header = [] // An array of unfolded header lines
    this.headers = {} // An object that holds header key=value pairs
    this.bodystructure = ''
    this.childNodes = [] // If this is a multipart or message/rfc822 mime part, the value will be converted to array and hold all child nodes for this node
    this.raw = '' // Stores the raw content of this node

    this._state = 'HEADER' // Current state, always starts out with HEADER
    this._bodyBuffer = '' // Body buffer
    this._lineCount = 0 // Line counter bor the body part
    this._currentChild = false // Active child node (if available)
    this._lineRemainder = '' // Remainder string when dealing with base64 and qp values
    this._isMultipart = false // Indicates if this is a multipart node
    this._multipartBoundary = false // Stores boundary value for current multipart node
    this._isRfc822 = false // Indicates if this is a message/rfc822 node
  }

  writeLine (line) {
    this.raw += (this.raw ? '\n' : '') + line

    if (this._state === 'HEADER') {
      this._processHeaderLine(line)
    } else if (this._state === 'BODY') {
      this._processBodyLine(line)
    }
  }

  finalize () {
    if (this._isRfc822) {
      this._currentChild.finalize()
    } else {
      this._emitBody()
    }

    this.bodystructure = this.childNodes
      .reduce((agg, child) => agg + '--' + this._multipartBoundary + '\n' + child.bodystructure, this.header.join('\n') + '\n\n') +
      (this._multipartBoundary ? '--' + this._multipartBoundary + '--\n' : '')
  }

  _decodeBodyBuffer () {
    switch (this.contentTransferEncoding.value) {
      case 'base64':
        this._bodyBuffer = base64Decode(this._bodyBuffer, this.charset)
        break
      case 'quoted-printable': {
        this._bodyBuffer = this._bodyBuffer
          .replace(/=(\r?\n|$)/g, '')
          .replace(/=([a-f0-9]{2})/ig, (m, code) => String.fromCharCode(parseInt(code, 16)))
        break
      }
    }
  }

  /**
   * Processes a line in the HEADER state. It the line is empty, change state to BODY
   *
   * @param {String} line Entire input line as 'binary' string
   */
  _processHeaderLine (line) {
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
  _parseHeaders () {
    for (let hasBinary = false, i = 0, len = this.header.length; i < len; i++) {
      let value = this.header[i].split(':')
      const key = (value.shift() || '').trim().toLowerCase()
      value = (value.join(':') || '').replace(/\n/g, '').trim()

      if (value.match(/[\u0080-\uFFFF]/)) {
        if (!this.charset) {
          hasBinary = true
        }
        // use default charset at first and if the actual charset is resolved, the conversion is re-run
        value = decode(convert(str2arr(value), this.charset || 'iso-8859-1'))
      }

      this.headers[key] = (this.headers[key] || []).concat([this._parseHeaderValue(key, value)])

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

    this.fetchContentType()
    this._processContentTransferEncoding()
  }

  /**
   * Parses single header value
   * @param {String} key Header key
   * @param {String} value Value for the key
   * @return {Object} parsed header
   */
  _parseHeaderValue (key, value) {
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

    this._decodeHeaderCharset(parsedValue, { isAddress })

    return parsedValue
  }

  /**
   * Checks if a date string can be parsed. Falls back replacing timezone
   * abbrevations with timezone values. Bogus timezones default to UTC.
   *
   * @param {String} str Date header
   * @returns {String} UTC date string if parsing succeeded, otherwise returns input value
   */
  _parseDate (str = '') {
    const date = new Date(str.trim().replace(/\b[a-z]+$/i, tz => timezone[tz.toUpperCase()] || '+0000'))
    return (date.toString() !== 'Invalid Date') ? date.toUTCString().replace(/GMT/, '+0000') : str
  }

  _decodeHeaderCharset (parsed, { isAddress } = {}) {
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
    if (isAddress && Array.isArray(parsed.value)) {
      parsed.value.forEach(addr => {
        if (addr.name) {
          addr.name = mimeWordsDecode(addr.name)
          if (Array.isArray(addr.group)) {
            this._decodeHeaderCharset({ value: addr.group }, { isAddress: true })
          }
        }
      })
    }

    return parsed
  }

  /**
   * Parses Content-Type value and selects following actions.
   */
  fetchContentType () {
    const defaultValue = parseHeaderValue('text/plain')
    this.contentType = pathOr(defaultValue, ['headers', 'content-type', '0'])(this)
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

    /**
     * For attachment (inline/regular) if charset is not defined and attachment is non-text/*,
     * then default charset to binary.
     * Refer to issue: https://github.com/emailjs/emailjs-mime-parser/issues/18
     */
    const defaultContentDispositionValue = parseHeaderValue('')
    const contentDisposition = pathOr(defaultContentDispositionValue, ['headers', 'content-disposition', '0'])(this)
    const isAttachment = (contentDisposition.value || '').toLowerCase().trim() === 'attachment'
    const isInlineAttachment = (contentDisposition.value || '').toLowerCase().trim() === 'inline'
    if ((isAttachment || isInlineAttachment) && this.contentType.type !== 'text' && !this.charset) {
      this.charset = 'binary'
    }

    if (this.contentType.value === 'message/rfc822' && !isAttachment) {
      /**
       * Parse message/rfc822 only if the mime part is not marked with content-disposition: attachment,
       * otherwise treat it like a regular attachment
       */
      this._currentChild = new MimeNode(this.nodeCounter)
      this.childNodes = [this._currentChild]
      this._isRfc822 = true
    }
  }

  /**
   * Parses Content-Transfer-Encoding value to see if the body needs to be converted
   * before it can be emitted
   */
  _processContentTransferEncoding () {
    const defaultValue = parseHeaderValue('7bit')
    this.contentTransferEncoding = pathOr(defaultValue, ['headers', 'content-transfer-encoding', '0'])(this)
    this.contentTransferEncoding.value = pathOr('', ['contentTransferEncoding', 'value'])(this).toLowerCase().trim()
  }

  /**
   * Processes a line in the BODY state. If this is a multipart or rfc822 node,
   * passes line value to child nodes.
   *
   * @param {String} line Entire input line as 'binary' string
   */
  _processBodyLine (line) {
    if (this._isMultipart) {
      if (line === '--' + this._multipartBoundary) {
        this.bodystructure += line + '\n'
        if (this._currentChild) {
          this._currentChild.finalize()
        }
        this._currentChild = new MimeNode(this.nodeCounter)
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
      this._lineCount++

      switch (this.contentTransferEncoding.value) {
        case 'base64':
          this._bodyBuffer += line
          break
        case 'quoted-printable': {
          let curLine = this._lineRemainder + (this._lineCount > 1 ? '\n' : '') + line
          const match = curLine.match(/=[a-f0-9]{0,1}$/i)
          if (match) {
            this._lineRemainder = match[0]
            curLine = curLine.substr(0, curLine.length - this._lineRemainder.length)
          } else {
            this._lineRemainder = ''
          }
          this._bodyBuffer += curLine
          break
        }
        case '7bit':
        case '8bit':
        default:
          this._bodyBuffer += (this._lineCount > 1 ? '\n' : '') + line
          break
      }
    }
  }

  /**
   * Emits a chunk of the body
  */
  _emitBody () {
    this._decodeBodyBuffer()
    if (this._isMultipart || !this._bodyBuffer) {
      return
    }

    this._processFlowedText()
    this.content = str2arr(this._bodyBuffer)
    this._processHtmlText()
    this._bodyBuffer = ''
  }

  _processFlowedText () {
    const isText = /^text\/(plain|html)$/i.test(this.contentType.value)
    const isFlowed = /^flowed$/i.test(pathOr('', ['contentType', 'params', 'format'])(this))
    if (!isText || !isFlowed) return

    const delSp = /^yes$/i.test(this.contentType.params.delsp)
    this._bodyBuffer = this._bodyBuffer.split('\n')
      .reduce(function (previousValue, currentValue) {
        // remove soft linebreaks after space symbols.
        // delsp adds spaces to text to be able to fold it.
        // these spaces can be removed once the text is unfolded
        const endsWithSpace = / $/.test(previousValue)
        const isBoundary = /(^|\n)-- $/.test(previousValue)
        return (delSp ? previousValue.replace(/[ ]+$/, '') : previousValue) + ((endsWithSpace && !isBoundary) ? '' : '\n') + currentValue
      })
      .replace(/^ /gm, '') // remove whitespace stuffing http://tools.ietf.org/html/rfc3676#section-4.4
  }

  _processHtmlText () {
    const contentDisposition = (this.headers['content-disposition'] && this.headers['content-disposition'][0]) || parseHeaderValue('')
    const isHtml = /^text\/(plain|html)$/i.test(this.contentType.value)
    const isAttachment = /^attachment$/i.test(contentDisposition.value)
    if (isHtml && !isAttachment) {
      if (!this.charset && /^text\/html$/i.test(this.contentType.value)) {
        this.charset = this.detectHTMLCharset(this._bodyBuffer)
      }

      // decode "binary" string to an unicode string
      if (!/^utf[-_]?8$/i.test(this.charset)) {
        this.content = convert(str2arr(this._bodyBuffer), this.charset || 'iso-8859-1')
      } else if (this.contentTransferEncoding.value === 'base64') {
        this.content = utf8Str2arr(this._bodyBuffer)
      }

      // override charset for text nodes
      this.charset = this.contentType.params.charset = 'utf-8'
    }
  }

  /**
   * Detect charset from a html file
   *
   * @param {String} html Input HTML
   * @returns {String} Charset if found or undefined
   */
  detectHTMLCharset (html) {
    let charset, input

    html = html.replace(/\r?\n|\r/g, ' ')
    let meta = html.match(/<meta\s+http-equiv=["'\s]*content-type[^>]*?>/i)
    if (meta) {
      input = meta[0]
    }

    if (input) {
      charset = input.match(/charset\s?=\s?([a-zA-Z\-_:0-9]*);?/)
      if (charset) {
        charset = (charset[1] || '').trim().toLowerCase()
      }
    }

    meta = html.match(/<meta\s+charset=["'\s]*([^"'<>/\s]+)/i)
    if (!charset && meta) {
      charset = (meta[1] || '').trim().toLowerCase()
    }

    return charset
  }
}

const str2arr = str => new Uint8Array(str.split('').map(char => char.charCodeAt(0)))
const utf8Str2arr = str => new TextEncoder('utf-8').encode(str)

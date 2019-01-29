/* eslint-disable no-unused-expressions */

import MimeNode from './node'

describe('MimeNode tests', function () {
  let node

  beforeEach(() => {
    node = new MimeNode()
  })

  describe('#writeLine', function () {
    it('should process the line according to current state', function () {
      sinon.stub(node, '_processHeaderLine')
      sinon.stub(node, '_processBodyLine')

      node._state = 'HEADER'
      node.writeLine('abc')

      node._state = 'BODY'
      node.writeLine('def')

      expect(node._processHeaderLine.withArgs('abc').callCount).to.equal(1)
      expect(node._processBodyLine.withArgs('def').callCount).to.equal(1)
    })
  })

  describe('#finalize', function () {
    it('should call emit if needed', function () {
      node._currentChild = {
        finalize: function () {}
      }

      sinon.stub(node, '_emitBody')
      sinon.stub(node._currentChild, 'finalize')

      node._isRfc822 = false
      node.finalize()

      node._isRfc822 = true
      node.finalize()

      expect(node._emitBody.callCount).to.equal(1)
      expect(node._currentChild.finalize.callCount).to.equal(1)
    })
  })

  describe('#_processHeaderLine', function () {
    it('should start body on empty line', function () {
      sinon.stub(node, '_parseHeaders')

      node._state = 'HEADER'
      node._processHeaderLine('')

      expect(node._state).to.equal('BODY')
      expect(node._parseHeaders.callCount).to.equal(1)
    })

    it('should push a line to the header', function () {
      node.header = []

      node._processHeaderLine('abc')
      node._processHeaderLine(' def')
      node._processHeaderLine(' ghi')
      node._processHeaderLine('jkl')

      expect(node.header).to.deep.equal(['abc\n def\n ghi', 'jkl'])
    })
  })

  describe('#_parseHeaders', function () {
    it('should parse header values', function () {
      sinon.stub(node, '_parseHeaderValue').callsFake((a, b) => b)
      sinon.stub(node, '_processContentType')
      sinon.stub(node, '_processContentTransferEncoding')

      node.headers = {}
      node.header = ['ABC: def', 'GHI: jkl']

      node._parseHeaders()

      expect(node.headers).to.deep.equal({
        abc: ['def'],
        ghi: ['jkl']
      })
      expect(node._parseHeaderValue.withArgs('abc', 'def').callCount).to.equal(1)
      expect(node._parseHeaderValue.withArgs('ghi', 'jkl').callCount).to.equal(1)
      expect(node._processContentType.callCount).to.equal(1)
      expect(node._processContentTransferEncoding.callCount).to.equal(1)
    })

    it('should default to latin1 charset for binary', function () {
      sinon.stub(node, '_parseHeaderValue').callsFake((a, b) => (a === 'content-type') ? {value: b, params: {}} : b)
      sinon.stub(node, '_processContentType')
      sinon.stub(node, '_processContentTransferEncoding')

      node.headers = {}
      node.header = ['a: \xD5\xC4\xD6\xDC', 'Content-Type: text/plain', 'b: \xD5\xC4\xD6\xDC']
      node._parseHeaders()

      expect(node.headers).to.deep.equal({
        a: ['ÕÄÖÜ'],
        b: ['ÕÄÖÜ'],
        'content-type': [{
          value: 'text/plain',
          params: {}
        }]
      })
    })

    it('should detect utf8 charset for binary', function () {
      sinon.stub(node, '_parseHeaderValue').callsFake((a, b) => (a === 'content-type') ? { value: b, params: { charset: 'utf-8' } } : b)
      sinon.stub(node, '_processContentType')
      sinon.stub(node, '_processContentTransferEncoding')

      node.headers = {}
      node.header = ['a: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C', 'Content-Type: text/plain', 'b: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C']
      node._parseHeaders()

      expect(node.headers).to.deep.equal({
        a: ['ÕÄÖÜ'],
        b: ['ÕÄÖÜ'],
        'content-type': [{
          value: 'text/plain',
          params: {
            charset: 'utf-8'
          }
        }]
      })
    })
  })

  describe('#_parseHeaderValue', function () {
    it('should parse objects', function () {
      sinon.stub(node, '_decodeHeaderCharset')

      expect(node._parseHeaderValue('content-type', 'text/plain; charset=utf-8')).to.deep.equal({
        initial: 'text/plain; charset=utf-8',
        value: 'text/plain',
        params: {
          charset: 'utf-8'
        }
      })

      expect(node._decodeHeaderCharset.callCount).to.equal(1)
    })

    it('should parse addresses', function () {
      sinon.stub(node, '_decodeHeaderCharset')

      expect(node._parseHeaderValue('to', 'a@b.ce')).to.deep.equal({
        initial: 'a@b.ce',
        value: [{
          name: '',
          address: 'a@b.ce'
        }]
      })

      expect(node._decodeHeaderCharset.callCount).to.equal(1)
    })

    it('should preserve strings', function () {
      sinon.stub(node, '_decodeHeaderCharset')

      expect(node._parseHeaderValue('x-my', 'zzzz')).to.deep.equal({
        initial: 'zzzz',
        value: 'zzzz'
      })

      expect(node._decodeHeaderCharset.callCount).to.equal(1)
    })

    it('should have unicode subject with strange characters', function () {
      expect(node._parseHeaderValue('Subject', '=?UTF-8?Q?=CB=86=C2=B8=C3=81=C3=8C=C3=93=C4=B1?=\r\n =?UTF-8?Q?=C3=8F=CB=87=C3=81=C3=9B^=C2=B8\\=C3=81?=\r\n =?UTF-8?Q?=C4=B1=CB=86=C3=8C=C3=81=C3=9B=C3=98^\\?=\r\n =?UTF-8?Q?=CB=9C=C3=9B=CB=9D=E2=84=A2=CB=87=C4=B1?=\r\n =?UTF-8?Q?=C3=93=C2=B8^\\=CB=9C=EF=AC=81^\\=C2=B7\\?=\r\n =?UTF-8?Q?=CB=9C=C3=98^=C2=A3=CB=9C#=EF=AC=81^\\?=\r\n =?UTF-8?Q?=C2=A3=EF=AC=81^\\=C2=A3=EF=AC=81^\\?=').value).to.equal('ˆ¸ÁÌÓıÏˇÁÛ^¸\\ÁıˆÌÁÛØ^\\˜Û˝™ˇıÓ¸^\\˜ﬁ^\\·\\˜Ø^£˜#ﬁ^\\£ﬁ^\\£ﬁ^\\')
    })
  })

  describe('#_parseDate', function () {
    it('should parse Date object', function () {
      var date = 'Thu, 15 May 2014 11:53:30 +0100'
      expect(node._parseDate(date)).to.equal('Thu, 15 May 2014 10:53:30 +0000')
    })

    it('should parse Date object with tz abbr', function () {
      var date = 'Thu, 15 May 2014 10:53:30 UTC'
      expect(node._parseDate(date)).to.equal('Thu, 15 May 2014 10:53:30 +0000')
    })

    it('should parse Date object with european tz', function () {
      var date = 'Thu, 15 May 2014 13:53:30 EEST'
      expect(node._parseDate(date)).to.equal('Thu, 15 May 2014 10:53:30 +0000')
    })

    it('should return original on unexpected input', function () {
      var date = 'Thu, 15 May 2014 13:53:30 YYY'
      expect(node._parseDate(date)).to.equal('Thu, 15 May 2014 13:53:30 +0000')
    })
  })

  describe('#_decodeHeaderCharset', function () {
    it('should decode object values', function () {
      expect(node._decodeHeaderCharset({
        value: 'tere =?iso-8859-1?Q?=F5=E4=F6=FC?='
      })).to.deep.equal({
        value: 'tere õäöü'
      })

      expect(node._decodeHeaderCharset({
        params: {
          a: 'tere =?iso-8859-1?Q?=F5=E4=F6=FC?='
        }
      })).to.deep.equal({
        params: {
          a: 'tere õäöü'
        }
      })
    })

    it('should decode addresses', function () {
      expect(node._decodeHeaderCharset({
        value: [{
          name: 'tere =?iso-8859-1?Q?=F5=E4=F6=FC?='
        }]
      }, {
        isAddress: true
      })).to.deep.equal({
        value: [{
          name: 'tere õäöü'
        }]
      })
    })
  })

  describe('#_processContentType', function () {
    it('should fetch special properties from content-type header', function () {
      node.headers['content-type'] = [{
        value: 'multipart/mixed',
        params: {
          charset: 'utf-8',
          boundary: 'zzzz'
        }
      }]

      node._processContentType()

      expect(node.contentType).to.deep.equal({
        value: 'multipart/mixed',
        type: 'multipart',
        params: {
          charset: 'utf-8',
          boundary: 'zzzz'
        }
      })
      expect(node.charset).to.equal('utf-8')
      expect(node._isMultipart).to.equal('mixed')
      expect(node._multipartBoundary).to.equal('zzzz')
    })

    it('should set charset to binary for attachment when there is no charset', function () {
      node.headers['content-type'] = [{
        value: 'application/pdf'
      }]

      node.headers['content-disposition'] = [{
        value: 'attachment'
      }]

      node._processContentType()

      expect(node.contentType).to.deep.equal({
        value: 'application/pdf',
        type: 'application'
      })
      expect(node.charset).to.equal('binary')
    })

    it('should set charset to binary for inline attachment when there is no charset', function () {
      node.headers['content-type'] = [{
        value: 'image/png'
      }]

      node.headers['content-disposition'] = [{
        value: 'inline'
      }]

      node._processContentType()

      expect(node.contentType).to.deep.equal({
        value: 'image/png',
        type: 'image'
      })
      expect(node.charset).to.equal('binary')
    })

    it('should not set charset to binary for inline attachment when there is a charset', function () {
      node.headers['content-type'] = [{
        value: 'image/png',
        params: {
          charset: 'US-ASCII'
        }
      }]

      node.headers['content-disposition'] = [{
        value: 'inline'
      }]

      node._processContentType()

      expect(node.contentType).to.deep.equal({
        value: 'image/png',
        type: 'image',
        params: {
          charset: 'US-ASCII'
        }
      })
      expect(node.charset).to.equal('US-ASCII')
    })

    it('should not set charset to binary for text/* attachment when there is no charset', function () {
      node.headers['content-type'] = [{
        value: 'text/plain'
      }]

      node.headers['content-disposition'] = [{
        value: 'attachment'
      }]

      node._processContentType()

      expect(node.contentType).to.deep.equal({
        value: 'text/plain',
        type: 'text'
      })
      expect(node.charset).to.be.undefined
    })

    it('should not set charset to binary for text/* attachment when there is a charset', function () {
      node.headers['content-type'] = [{
        value: 'text/plain',
        params: {
          charset: 'US-ASCII'
        }
      }]

      node.headers['content-disposition'] = [{
        value: 'attachment'
      }]

      node._processContentType()

      expect(node.contentType).to.deep.equal({
        value: 'text/plain',
        type: 'text',
        params: {
          charset: 'US-ASCII'
        }
      })
      expect(node.charset).to.equal('US-ASCII')
    })
  })

  describe('#_processContentTransferEncoding', function () {
    it('should fetch special properties from content-transfer-encoding header', function () {
      node.headers['content-transfer-encoding'] = [{
        value: 'BASE64'
      }]

      node._processContentTransferEncoding()

      expect(node.contentTransferEncoding).to.deep.equal({
        value: 'base64'
      })
    })

    it('should set default transfer encoding to 7bit', function () {
      node._processContentTransferEncoding()

      expect(node.contentTransferEncoding).to.deep.equal({
        value: '7bit',
        params: {}
      })
    })
  })

  describe('#_processBodyLine', function () {
    describe('multipart nodes', function () {
      it('should add new node on boundary', function () {
        node.childNodes = []
        node._isMultipart = 'mixed'
        node._multipartBoundary = 'zzz'

        node._processBodyLine('--zzz')

        expect(node.childNodes.length).to.equal(1)
        var finalizeStub = sinon.stub(node._currentChild, 'finalize')

        node._processBodyLine('--zzz')
        expect(node.childNodes.length).to.equal(2)
        expect(finalizeStub.callCount).to.equal(1)
      })

      it('should close node on boundary', function () {
        node._isMultipart = 'mixed'
        node._multipartBoundary = 'zzz'
        node._currentChild = {
          finalize: function () {}
        }
        node.childNodes = [node._currentChild]

        var finalizeStub = sinon.stub(node._currentChild, 'finalize')
        node._processBodyLine('--zzz--')
        expect(finalizeStub.callCount).to.equal(1)
      })

      it('should write a line to the current node', function () {
        node._isMultipart = 'mixed'
        node._multipartBoundary = 'zzz'
        node._currentChild = {
          writeLine: function () {}
        }
        node.childNodes = [node._currentChild]

        var writeLineStub = sinon.stub(node._currentChild, 'writeLine')
        node._processBodyLine('abc')
        expect(writeLineStub.withArgs('abc').callCount).to.equal(1)
      })
    })

    it('should write a line to the current RFC822 node', function () {
      node._isRfc822 = true
      node._currentChild = {
        writeLine: function () {}
      }
      node.childNodes = [node._currentChild]

      var writeLineStub = sinon.stub(node._currentChild, 'writeLine')
      node._processBodyLine('abc')
      expect(writeLineStub.withArgs('abc').callCount).to.equal(1)
    })

    it('should process non-utf8 base64 data and emit binary string', function () {
      node.contentTransferEncoding = {
        value: 'base64'
      }

      node._lineRemainder = ''
      node._processBodyLine('4pSB4pSB4pSB4pSB4pSB4pSB4pSB4pSB4pSBCuacrOODoeODvOODq+OBr+OAgeODnuOCpOODiuOD')
      node._base64DecodeBodyBuffer()

      expect(node._bodyBuffer).to.equal('━━━━━━━━━\n本メールは、マイナ�')
    })

    it('should process quoted-printable data', function () {
              // =C3=B5=C3=A4=C3=B6=C3=BC
      node.contentTransferEncoding = {
        value: 'quoted-printable'
      }

      node._lineRemainder = '=C'
      node._processBodyLine('3=B5=C3=A4=C')

      expect(node._lineRemainder).to.equal('=C')
      expect(node._bodyBuffer).to.equal('ÃµÃ¤')
    })

    it('should process unencoded input', function () {
      node.contentTransferEncoding = {
        value: 'uuu'
      }
      node._processBodyLine('zzzz')
      node._processBodyLine('xxxx')

      expect(node._bodyBuffer).to.equal('zzzz\nxxxx')
    })
  })

  describe('#_emitBody', function () {
    it('should emit an undecoded typed array for non text nodes', function () {
      node.contentType = {
        value: 'attachment/bin'
      }

      node._bodyBuffer = '\xfe\xf0'
      node._emitBody()

      expect(node.content).to.deep.equal(new Uint8Array([0xfe, 0xf0]))
    })

    it('should emit a decoded typed array for text nodes', function () {
      node.contentType = {
        value: 'text/plain',
        params: {
          charset: 'iso-8859-1'
        }
      }
      node.charset = 'iso-8859-13'
      node._bodyBuffer = '\xfe\xf0'
      node._emitBody()

      expect(node.content).to.deep.equal(new Uint8Array([0xC5, 0xBE, 0xC5, 0xA1]))
      expect(node.charset).to.equal('utf-8')
    })

    it('should check non unicode charset from html', function () {
      sinon.stub(node, '_detectHTMLCharset').returns('iso-8859-13')

      node.contentType = {
        value: 'text/html',
        params: {}
      }
      node._bodyBuffer = '\xfe\xf0'
      node._emitBody()

      expect(node.content).to.deep.equal(new Uint8Array([0xC5, 0xBE, 0xC5, 0xA1]))
      expect(node.charset).to.equal('utf-8')
    })

    it('should check unicode charset from html', function () {
      sinon.stub(node, '_detectHTMLCharset').returns('utf-8')

      node.contentType = {
        value: 'text/html',
        params: {}
      }
      node._bodyBuffer = '\xC5\xBE\xC5\xA1'
      node._emitBody()

      expect(node.content).to.deep.equal(new Uint8Array([0xC5, 0xBE, 0xC5, 0xA1]))
      expect(node.charset).to.equal('utf-8')
    })
  })

  describe('#_detectHTMLCharset', function () {
    it('should detect charset from simple meta', function () {
      expect(node._detectHTMLCharset('\n\n<meta charset="utf-8">')).to.equal('utf-8')
      expect(node._detectHTMLCharset('\n\n<meta\n charset="utf-8">')).to.equal('utf-8')
      expect(node._detectHTMLCharset('\n\n<meta\n charset=utf-8>')).to.equal('utf-8')
    })

    it('should detect charset from http-equiv meta', function () {
      expect(node._detectHTMLCharset('\n\n<meta http-equiv="content-type" content="text/html; charset=utf-8" />')).to.equal('utf-8')
      expect(node._detectHTMLCharset('\n\n<meta http-equiv=content-type content="text/html; charset=utf-8" />')).to.equal('utf-8')
    })
  })
})

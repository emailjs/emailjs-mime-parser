/* eslint-disable no-unused-expressions */

import parse, { MimeNode, NodeCounter } from './mimeparser'
import { TextDecoder } from 'text-encoding'

describe('Header parsing', () => {
  it('should succeed', function () {
    var fixture = 'From: Sender Name <sender.name@example.com>\r\n' +
      'Subject: Hello world!\r\n' +
      'Date: Fri, 4 Oct 2013 07:17:32 +0000\r\n' +
      'Message-Id: <simplemessage@localhost>\r\n' +
      'Content-Type: multipart/signed; protocol="TYPE/STYPE"; micalg="MICALG"; boundary="Signed Boundary"\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n' +
      '\r\n'

    const root = parse(fixture)
    expect(root.headers.from).to.deep.equal([{
      value: [{
        address: 'sender.name@example.com',
        name: 'Sender Name'
      }],
      initial: 'Sender Name <sender.name@example.com>'
    }])

    expect(root.headers.subject).to.deep.equal([{
      value: 'Hello world!',
      initial: 'Hello world!'
    }])

    expect(root.headers['content-transfer-encoding']).to.deep.equal([{
      value: 'quoted-printable',
      initial: 'quoted-printable',
      params: {}
    }])
    expect(root.contentTransferEncoding).to.deep.equal({
      value: 'quoted-printable',
      initial: 'quoted-printable',
      params: {}
    })

    expect(root.headers['content-type']).to.deep.equal([{
      value: 'multipart/signed',
      params: {
        boundary: 'Signed Boundary',
        micalg: 'MICALG',
        protocol: 'TYPE/STYPE'
      },
      type: 'multipart',
      initial: 'multipart/signed; protocol="TYPE/STYPE"; micalg="MICALG"; boundary="Signed Boundary"'
    }])
  })

  it('should parse encoded headers', function () {
    var fixture = 'Subject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n' +
      ' =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n' +
      'Content-Disposition: attachment;\r\n' +
      '  filename*0*=UTF-8\'\'%C3%95%C3%84;\r\n' +
      '  filename*1*=%C3%96%C3%9C\r\n' +
      'From: =?gb2312?B?086yyZjl?= user@ldkf.com.tw\r\n' +
      'To: =?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?=:=?gb2312?B?086yyZjl?= user@ldkf.com.tw;\r\n' +
      'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
      '\r\n' +
      'abc'

    const root = parse(fixture)

    expect(root.headers['subject']).to.deep.equal([{
      value: 'Avaldus lepingu lõpetamiseks',
      initial: '=?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?= =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?='
    }])
    expect(root.headers['content-disposition']).to.deep.equal([{
      value: 'attachment',
      params: {
        filename: 'ÕÄÖÜ'
      },
      initial: 'attachment;  filename*0*=UTF-8\'\'%C3%95%C3%84;  filename*1*=%C3%96%C3%9C'
    }, {
      value: 'attachment',
      params: {
        filename: 'ÕÄÖÜ'
      },
      initial: 'attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="'
    }])
    expect(root.headers['from']).to.deep.equal([{
      value: [{
        address: 'user@ldkf.com.tw',
        name: '游采樺'
      }],
      initial: '=?gb2312?B?086yyZjl?= user@ldkf.com.tw'
    }])
    expect(root.headers['to']).to.deep.equal([{
      value: [{
        name: 'ÕÄÖÜ',
        group: [{
          address: 'user@ldkf.com.tw',
          name: '游采樺'
        }]
      }],
      initial: '=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?=:=?gb2312?B?086yyZjl?= user@ldkf.com.tw;'
    }])
  })

  it('should use latin1 as the default for headers', function () {
    var fixture = 'a: \xD5\xC4\xD6\xDC\r\n' +
      'Content-Type: text/plain\r\n' +
      'b: \xD5\xC4\xD6\xDC\r\n' +
      '\r\n' +
      ''
    const root = parse(fixture)
    expect(root.headers.a[0].value).to.equal('ÕÄÖÜ')
    expect(root.headers.b[0].value).to.equal('ÕÄÖÜ')
  })

  it('should detect 8bit header encoding', function () {
    var fixture = 'a: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      'b: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C\r\n' +
      '\r\n'
    const root = parse(fixture)
    expect(root.headers.a[0].value).to.equal('ÕÄÖÜ')
    expect(root.headers.b[0].value).to.equal('ÕÄÖÜ')
  })
})

describe('Body parsing', () => {
  it('should decode unencoded 7bit input', function () {
    var fixture = 'Content-Type: text/plain\r\n' +
      '\r\n' +
      'xxxx\r\n' +
      'yyyy'
    const root = parse(fixture)
    expect(new TextDecoder('utf-8').decode(root.content)).to.equal('xxxx\nyyyy')
  })

  it('should decode utf-8 base64', function () {
    var fixture = 'Content-Type: text/plain; charset="utf-8"\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      '\r\n' +
      '4pSB4pSB4pSB4pSB4pSB4pSB4pSB4pSB4pSBCuacrOODoeODvOODq+OBr+OAgeODnuOCpOODiuOD\r\n'
    const root = parse(fixture)
    expect(new TextDecoder('utf-8').decode(root.content)).to.equal('━━━━━━━━━\n本メールは、マイナ�')
  })

  it('should decode latin-1 quoted-printable', function () {
    var fixture = 'Content-Type: text/plain; charset="latin_1"\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n' +
      '\r\n' +
      'l=F5petam'
    var expectedText = 'lõpetam'
    const root = parse(fixture)
    expect(new TextDecoder('utf-8').decode(root.content)).to.equal(expectedText)
  })

  it('should ignore charset for plaintext attachment', function () {
    var fixture = 'Content-Type: text/plain; charset="latin_1"\r\n' +
      'Content-Disposition: attachment\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n' +
      '\r\n' +
      'l=F5petam'
    var expectedText = 'lõpetam'
    const root = parse(fixture)
    expect(new TextDecoder('iso-8859-1').decode(root.content)).to.equal(expectedText)
  })

  // TODO Add test for multipart message
  // TODO Add test for RFC-822

  describe('HTML parsing', () => {
    it('should detect charset from html meta and convert html text to utf-8', function () {
      var fixture = 'Content-Type: text/plain;\r\n' +
        'Content-Transfer-Encoding: quoted-printable\r\n' +
        '\r\n' +
        '=3Cmeta=20charset=3D=22latin_1=22/=3E=D5=C4=D6=DC'
      var expectedText = '<meta charset="latin_1"/>ÕÄÖÜ'
      const root = parse(fixture)
      expect(new TextDecoder('utf-8').decode(root.content)).to.equal(expectedText)
    })
  })

  describe('Flowed text formatting', () => {
    it('should parse format=flowed text', function () {
      var fixture = 'Content-Type: text/plain; format=flowed\r\n\r\nFirst line \r\ncontinued \r\nand so on\n-- \nSignature\ntere\n From\n  Hello\n > abc\nabc\n'

      const root = parse(fixture)
      expect(new TextDecoder('utf-8').decode(root.content)).to.equal('First line continued and so on\n-- \nSignature\ntere\nFrom\n Hello\n> abc\nabc\n')
    })

    it('should not corrupt format=flowed text that is not flowed', function () {
      var fixture = 'Content-Type: text/plain; format=flowed\r\n\r\nFirst line.\r\nSecond line.\r\n'

      const root = parse(fixture)
      expect(new TextDecoder('utf-8').decode(root.content)).to.equal('First line.\nSecond line.\n')
    })

    it('should parse format=fixed text', function () {
      var fixture = 'Content-Type: text/plain; format=fixed\r\n\r\nFirst line \r\ncontinued \r\nand so on'

      const root = parse(fixture)
      expect(new TextDecoder('utf-8').decode(root.content)).to.equal('First line \ncontinued \nand so on')
    })

    it('should parse delsp=yes text', function () {
      var fixture = 'Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\nFirst line \r\ncontinued \r\nand so on'

      const root = parse(fixture)
      expect(new TextDecoder('utf-8').decode(root.content)).to.equal('First linecontinuedand so on')
    })
  })
})

describe('Message parsing', function () {
  it('should succeed', function () {
    var fixture = 'Content-Type: text/plain; charset="utf-8"\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n' +
      '\r\n' +
      '\r\n' +
      'Hi,\r\n' +
      '\r\n' +
      'this is a private conversation. To read my encrypted message below, simply =\r\n' +
      'open it in Whiteout Mail.\r\n' +
      'Open Whiteout Mail: https://chrome.google.com/webstore/detail/jjgghafhamhol=\r\n' +
      'jigjoghcfcekhkonijg\r\n' +
      '\r\n'
    var expectedText = '\nHi,\n\nthis is a private conversation. To read my encrypted message below, simply open it in Whiteout Mail.\nOpen Whiteout Mail: https://chrome.google.com/webstore/detail/jjgghafhamholjigjoghcfcekhkonijg\n\n'

    const root = parse(fixture)
    expect(new TextDecoder('utf-8').decode(root.content)).to.equal(expectedText)
  })

  it('should decode S/MIME', () => {
    const testHeader = 'Content-Type: application/pkcs7-mime; name=smime.p7m; smime-type=enveloped-data; charset=binary\r\n' +
      'Content-Description: Enveloped Data\r\n' +
      'Content-Disposition: attachment; filename=smime.p7m\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'From: sender@example.com\r\n' +
      'To: recipient@example.com\r\n' +
      'Subject: Example S/MIME encrypted message\r\n' +
      'Date: Sun, 25 Feb 2018 09:28:14 +0000\r\n' +
      'Message-Id: <1519550894482-b208bdc8-7f8e90aa-4af6b4fa@example.com>\r\n' +
      'MIME-Version: 1.0\r\n' +
      '\r\n'

    const testMessage = 'MIIB3AYJKoZIhvcNAQcDoIIBzTCCAckCAQIxggFuMIIBagIBADAjMB4xHDAJBgNVBAYTAlJVMA8G\r\n' +
      'A1UEAx4IAFQAZQBzAHQCAQEwPAYJKoZIhvcNAQEHMC+gDzANBglghkgBZQMEAgMFAKEcMBoGCSqG\r\n' +
      'SIb3DQEBCDANBglghkgBZQMEAgMFAASCAQBDyepahKyM+hceeF7J+pyiSVYLElKyFKff9flMs1VX\r\n' +
      'ZaBQRcEYpIqw9agD4u+aHlIOJ6AtdCbxaV0M8q6gjM4E5lUFUOqG/QIycdG2asZ0lza/DL8SdxfA\r\n' +
      '3WE9Ij5IEqFbtnykbfORK+5XWT0nYs/OMN0NKeCwXjElNsezX9IAIgxHgwcVYW+szXpRlarjriAC\r\n' +
      'TDG/M+Xl5YtyAhmHWFncBSfWM8e2q+AKh3eCal1lH4eXtGICc4rad4f6845YJwXL8DYYS+GdLVAY\r\n' +
      'EXKuHr0N7g4aHTs9B8EQqHmYdaHWTi3h0ZPkvAE+wwfm9xjvL2z2HrfpYyMTvALrefvSt7sGMIAG\r\n' +
      'CSqGSIb3DQEHATAdBglghkgBZQMEAQIEEKt6VqFcNz/VYFwu85DTOqGggAQgIHc45LBiYIQqhxNw\r\n' +
      'hlRk4BxMiyiQRdLcVdCwwkKyX2sAAAAA\r\n'

    const expectedText = (Buffer.from(testMessage, 'base64')).toString('hex').toUpperCase()
    const root = parse(testHeader + testMessage)
    expect((Buffer.from(root.content.buffer)).toString('hex').toUpperCase()).to.deep.equal(expectedText)
  })

  it('should be resilient to memory exhaustion attack', () => {
    let numberOfMimeNodes = 9999
    const attackPayload = []
    while (numberOfMimeNodes--) {
      attackPayload.push('--0\r\n\r\n\r\n')
    }
    const fixture = 'Content-Type: multipart/mixed; boundary="0"\r\n\r\n' + attackPayload.join('')
    expect(() => parse(fixture)).to.throw('Maximum number of MIME nodes exceeded!')
  })
})

describe('Bodystructure', () => {
  it('should emit structure without values of nodes', function () {
    var fixture =
      'MIME-Version: 1.0\n' +
      'Content-Type: multipart/mixed;\n' +
      ' boundary="------------304E429112E7D6AC36F087A8"\n' +
      '\n' +
      'This is a multi-part message in MIME format.\n' +
      '--------------304E429112E7D6AC36F087A8\n' +
      'Content-Type: text/html; charset=utf-8\n' +
      'Content-Transfer-Encoding: 7bit\n' +
      '\n' +
      '<html/>\n' +
      '--------------304E429112E7D6AC36F087A8\n' +
      'Content-Type: text/plain; charset=UTF-8; x-mac-type="0"; x-mac-creator="0";\n' +
      ' name="hello.mime"\n' +
      'Content-Transfer-Encoding: base64\n' +
      'Content-Disposition: attachment;\n' +
      ' filename="hello.mime"\n' +
      '\n' +
      'SGkgbW9tIQ==\n' +
      '--------------304E429112E7D6AC36F087A8--\n'

    var expectedBodystructure =
      'MIME-Version: 1.0\n' +
      'Content-Type: multipart/mixed;\n' +
      ' boundary="------------304E429112E7D6AC36F087A8"\n' +
      '\n' +
      '--------------304E429112E7D6AC36F087A8\n' +
      'Content-Type: text/html; charset=utf-8\n' +
      'Content-Transfer-Encoding: 7bit\n' +
      '\n' +
      '--------------304E429112E7D6AC36F087A8\n' +
      'Content-Type: text/plain; charset=UTF-8; x-mac-type="0"; x-mac-creator="0";\n' +
      ' name="hello.mime"\n' +
      'Content-Transfer-Encoding: base64\n' +
      'Content-Disposition: attachment;\n' +
      ' filename="hello.mime"\n' +
      '\n' +
      '--------------304E429112E7D6AC36F087A8--\n'

    const root = parse(fixture)
    expect(root.childNodes).to.not.be.empty
    expect(root.bodystructure).to.equal(expectedBodystructure)
  })
})

describe('Date parsing', () => {
  it('should parse date header european tz', function () {
    const root = parse('Date: Thu, 15 May 2014 13:53:30 EEST\r\n\r\n')
    expect(root.headers.date[0].value).to.equal('Thu, 15 May 2014 10:53:30 +0000')
  })

  it('should parse Date object', function () {
    const root = parse('Date: Thu, 15 May 2014 11:53:30 +0100\r\n\r\n')
    expect(root.headers.date[0].value).to.equal('Thu, 15 May 2014 10:53:30 +0000')
  })

  it('should parse Date object with tz abbr', function () {
    const root = parse('Date: Thu, 15 May 2014 10:53:30 UTC\r\n\r\n')
    expect(root.headers.date[0].value).to.equal('Thu, 15 May 2014 10:53:30 +0000')
  })

  it('should return original on unexpected input', function () {
    const root = parse('Date: Thu, 15 May 2014 13:53:30 YYY\r\n\r\n')
    expect(root.headers.date[0].value).to.equal('Thu, 15 May 2014 13:53:30 +0000')
  })
})

describe('MimeNode', function () {
  let node

  beforeEach(() => {
    node = new MimeNode()
  })

  describe('#fetchContentType', function () {
    it('should fetch special properties from content-type header', function () {
      node.headers['content-type'] = [{
        value: 'multipart/mixed',
        params: {
          charset: 'utf-8',
          boundary: 'zzzz'
        }
      }]

      node.fetchContentType()

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

      node.fetchContentType()

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

      node.fetchContentType()

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

      node.fetchContentType()

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

      node.fetchContentType()

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

      node.fetchContentType()

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
})

describe('NodeCounter', () => {
  it('should throw at the 1000th invocation', () => {
    let invocations = 999
    const nodeCounter = new NodeCounter()
    while (invocations--) {
      expect(() => nodeCounter.bump()).to.not.throw()
    }
    expect(() => nodeCounter.bump()).to.throw()
  })
})

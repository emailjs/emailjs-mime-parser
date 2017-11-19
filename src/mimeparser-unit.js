/* eslint-disable no-unused-expressions */

import parse from './mimeparser'
import { TextDecoder } from 'text-encoding'

describe('message tests', function () {
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

  it('should parse specific headers', function () {
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

  it('should parse body', function () {
    var fixture = 'Content-Type: text/plain; name="foo.txt"\r\n' +
      'Content-Disposition: attachment; filename="foo.txt"\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      '\r\n' +
      'YXNkYXNkYXNkYQ==\r\n'
    const root = parse(fixture)
    expect(new TextDecoder('utf-8').decode(root.content)).to.equal('asdasdasda')
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
    expect(root.headers).to.deep.equal({
      subject: [{
        value: 'Avaldus lepingu lõpetamiseks',
        initial: '=?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?= =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?='
      }],
      'content-disposition': [{
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
      }],
      from: [{
        value: [{
          address: 'user@ldkf.com.tw',
          name: '游采樺'
        }],
        initial: '=?gb2312?B?086yyZjl?= user@ldkf.com.tw'
      }],
      to: [{
        value: [{
          name: 'ÕÄÖÜ',
          group: [{
            address: 'user@ldkf.com.tw',
            name: '游采樺'
          }]
        }],
        initial: '=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?=:=?gb2312?B?086yyZjl?= user@ldkf.com.tw;'
      }]
    })
  })

  it('should decode plaintext body from latin-1 charset', function () {
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

  it('should detect charset from html', function () {
    var fixture = 'Content-Type: text/plain;\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n' +
      '\r\n' +
      '=3Cmeta=20charset=3D=22latin_1=22/=3E=D5=C4=D6=DC'
    var expectedText = '<meta charset="latin_1"/>ÕÄÖÜ'
    const root = parse(fixture)
    expect(new TextDecoder('utf-8').decode(root.content)).to.equal(expectedText)
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

  it('should parse date header', function () {
    var fixture = 'Date: Thu, 15 May 2014 13:53:30 EEST\r\n' +
      '\r\n' +
      ''
    const root = parse(fixture)
    expect(root.headers.date[0].value).to.equal('Thu, 15 May 2014 10:53:30 +0000')
  })

  it('should detect 8bit header encoding from content-type', function () {
    var fixture = 'a: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      'b: \xC3\x95\xC3\x84\xC3\x96\xC3\x9C\r\n' +
      '\r\n'
    const root = parse(fixture)
    expect(root.headers.a[0].value).to.equal('ÕÄÖÜ')
    expect(root.headers.b[0].value).to.equal('ÕÄÖÜ')
  })

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

  it.skip('should emit bodystructure', function () {
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
    expect(root.contentstructure).to.equal(expectedBodystructure)
  })
})

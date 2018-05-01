# emailjs-mime-parser

[![Greenkeeper badge](https://badges.greenkeeper.io/emailjs/emailjs-mime-parser.svg)](https://greenkeeper.io/) [![Build Status](https://travis-ci.org/emailjs/emailjs-mime-parser.png?branch=master)](https://travis-ci.org/emailjs/emailjs-mime-parser) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)  [![ES6+](https://camo.githubusercontent.com/567e52200713e0f0c05a5238d91e1d096292b338/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f65732d362b2d627269676874677265656e2e737667)](https://kangax.github.io/compat-table/es6/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Parse a mime tree, no magic included. This is supposed to be a "low level" mime parsing module. No magic is performed on the data (eg. no joining HTML parts etc.). All body data is emitted out as Typed Arrays, so no need to perform any base64 or quoted printable decoding by yourself. Text parts are decoded to UTF-8 if needed.

## Usage

```
npm install --save emailjs-mime-parser
```

```javascript
import parse from 'emailjs-mime-parser'

parse(String) -> MimeNode
```

### MimeNode

A MimeNode represents a MIME tree.

```
MimeNode
|
+----> childNodes -> [MimeNode]
+----> content -> Uint8Array
+----> bodyStructure -> String
```

```
MimeNode.childNodes -> [MimeNode]
```

The child MIME nodes are stored in the `childNodes` array.

```
MimeNode.content -> Uint8Array
```

The content of the specific node is stored in `this.content` as Uint8Array. All body data is emitted as Typed Arrays, so no need to perform any base64 or quoted printable decoding by yourself. Text parts are decoded to UTF-8 if needed.

**message/rfc822** is automatically parsed if the mime part does not have a `Content-Disposition: attachment` header, otherwise it will be emitted as a regular attachment (as one long Uint8Array value).


```
MimeNode.bodyStructure -> String
```

Bodystructure is the original raw message stripped of bodies and multipart preambles. MIME stores like to store the bodystructure of MIME content in raw (loss-less) form, to later run through a MIME parser to answer IMAP or WebDAV type queries.

## License

    The MIT license

    Copyright (c) 2013 Andris Reinman

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    THE SOFTWARE.

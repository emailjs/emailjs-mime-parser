# mimeparser

Another prototype for parsing mime streams, see [example application here](https://github.com/Kreata/mimeparser-example).

## Scope

This is supposed to be a "low level" mime parsing module. No magic is performed on the data (eg. no joining HTML parts etc.). All body data is emitted out as ArrayBuffer values, so no need to perform any base64 or quoted printable decoding by yourself.

## Usage

### Volo

Install with [volo](http://volojs.org/):

    volo add Kreata/mimeparser/master

### AMD

Require [mimeparser.js](mimeparser.js) as `mimeparser`

### Create a parser

Create a parser by invoking `mimeparser()`

```javascript
var parser = mimeparser();
```

## Methods

### Feed data to the parser

Feed data with `write(chunk)`. Where `chunk` is supposed to be an ArrayBuffer or a "binary" string.

```javascript
parser.write("Subject: test\n\nHello world!");
```

When all data is feeded to the parser, call `end()`

```javascript
parser.end();
```

### Receiveing the output

You can receive the output by creating appropriate event handler functions.

#### Headers

To receive node headers, define `onheader` function

```javascript
parser.onheader = function(node){
    console.log(node.header.join("\n")); // List all headers
    console.log(node.headers["content-type"]); // List value for Content-Type
};
```

#### Body

Body is emitted in chunks of ArrayBuffers, define `onbody` to catch these chunks

```javascript
parser.onbody = function(node, chunk){
    console.log("Received " + chunk.byteLength + " bytes for " + node.path.join("."));
};
```

#### Parse end

When the parsing is finished, `onend` is called

```javascript
parser.onend = function(){
    console.log("Parsing is finished");
};
```

## Quirks

This seems like asynchronous but actually it is not. So always define `onheader`, `onbody` and `onend` before writing the first chunk of data to the parser.

**message/rfc822** is automatically parsed if the mime part does not have a `Content-Disposition: attachment` header, otherwise it will be emitted as a regular attachment (as one long ArrayBuffer value).

## Tests

Download `mimeparser` source and install dependencies

```bash
git clone git@github.com:Kreata/mimeparser.git
cd mailcomposer
volo install
```

Tests are handled by QUnit. Open [testrunner.html](tests/testrunner.html) to run the tests. There's only a few test currently, just to check for syntax errors but not so much individual features.

## License

**MIT**
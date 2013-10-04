# mimeparser

Another prototype for parsing mime streams, see [live demo here](http://tahvel.info/mimeparser/parse.html).

Run `volo install` to install the required dependencies before trying out the demo file by yourself.

## Scope

This is supposed to be a "low level" mime parsing module. No magic is performed on the data (eg. no joining HTML parts etc.). All body data is emitted out as ArrayBuffer values, so no need to perform any base64 or quoted printable decoding by yourself.

## Usage

### Create a parser

Create a parser by invoking `mimeparser()`

```javascript
var parser = mimeparser();
```

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

## License

**MIT**
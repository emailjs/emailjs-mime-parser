# mimeparser

Another prototype for parsing mime streams, see [live demo here](http://tahvel.info/mimeparser/parse.html).

Run `volo install` to install the required dependencies before trying out the demo file by yourself.

## Scope

This is supposed to be a "low level" mime parsing module. No magic is performed on the data (eg. no joining HTML parts etc.). All body data is emitted out as ArrayBuffer values, so no need to perform any base64 or quoted printable decoding by yourself.

## License

**MIT**
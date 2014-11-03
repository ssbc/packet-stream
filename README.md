# packet-stream

a simpler approach to rpc/multiplexing

## proir work

Over the course of streams and so on with node, there have been
many approaches to rpc and to multiplexing. substack's [dnode](https://github.com/substack/dnode)
was first - which supported async callbacks, but not streams.
I wrote [rpc-stream](https://github.com/dominictarr/rpc-stream) that was simpler
than dnode, but could be piped over any node stream - this soon came to dnode.
Later, I wrote [mux-demux](https://github.com/dominictarr/mux-demux)
which supported streams but not callbacks. This was pretty good, because
you could now stream many different things through one connection.
Unfortunately, mux-demux used json encoding, and so did not support binary very well.

When leveldb came around, juliangruber wrote [multilevel](https://github.com/juliangruber/multilevel)
which used mux-demux and rpc-stream to create remote access to a leveldb instance.
This worked pretty well, although it felt like a messy glue job.

Later, maxogden wrote [multiplex](https://github.com/maxogden/multiplex)
which had better support for binary, as was later wrapped to a more
convienient api by substack's
[dataplex](https://github.com/substack/dataplex)

But something still wasn't right. Thing is, if you look into how all these
modules are implemented, rpc or multiplexer, you'll see one thing:
framed messages are sent over a stream. Basically, a multiplexer
is tcp implemented on top of tcp, but is this really the right approach?

Shouldn't tcp be implemented on top of packets?

Any useful node api needs streams, but also needs callbacks and maybe events too.
So therefore `packet-stream` provides messages as the fundamental building block,
and implements request/response (async+callback) and streams (a sequence of messages)
on top of messages.

This is a low level module that implements the core logic necessary for an rpc
and multiplexing module - it is intended to be wrapped in something closer
to how the user thinks - like [muxrpc](https://github.com/dominictarr/muxrpc)

## Example

``` js
var packets = require('packet-stream')

var A = packets({
  //handle an ordinary message
  message: function (msg) { console.log ('message', msg) },

  //handle a request
  request: function (value, cb) {
    console.log('request', value)
    cb(null, {okay: true})
  })

  //handle a stream

  stream: function (stream) {
    console.log('connection')
    //create an echo server by connecting the stream to itself.
    //NOTE these are not normal node streams.
    stream.read = stream.write
  }

})

var B = packets({})

// same as A.pipe(B).pipe(A)
// but simpler to implement internally.
A.read = B.write; B.read = A.write

//send a message
B.message('HELLO THERE')

B.request({foo: 'bar'}, function (err, value) {
  if(err) throw err
  console.log('response', value)
})

var stream = B.stream()

stream.read = function (data) {
  console.log(data)
}

stream.write('open - write to stream')
```

## weird streams

yes, I have weird streams. But they are easy to wrap with
more normal streams and using simple message oriented streams
means that the entire implementation could fit into 100 lines,
correction 200 lines now that there is full error checking, and `close`

weird-stream have two methods - `read` and `write`. `read` is
for data coming out of the stream, and `write` is for data going in.

The user is required to reassign the read method to call another function,
for example, the write method of another stream.

``` js
// A.pipe(B)
A.read = B.write

// B.pipe(A)
B.read = A.write
```

`write(data, end)` and `read(data, end)` both take two arguments.
`data` and `end`. If `end` is truthy, `data` *must* be ignored.
back pressure is not currently supported.

## License

MIT

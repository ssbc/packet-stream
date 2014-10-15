# packet-stream

a simpler approach to rpc/multiplexing

# previous work

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
which had better support for binary, as well as substack's
[dataplex](https://github.com/substack/dataplex)

But something still wasn't right. Thing is, if you look into how all these
modules are implemented, rpc or multiplexer, you'll see one thing:
framed messages are sent over a stream. Basically, a multiplexer
is tcp implemented on top of tcp, but is this really the right approach?

Shouldn't tcp be implemented on top of packets?

Any useful node api needs streams, but also needs callbacks and maybe events too.

So therefore packet stream provides messages as the fundemantal building block,
and provideds request/response (async+callback) and streams (a sequence of messages)
as well.

Hopefully, this makes creating remote access to node apis easy and natural!

*WORK IN PROGRESS*


## License

MIT

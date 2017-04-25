function flat(err) {
  if(!err) return err
  if(err === true) return true
  return {message: err.message, name: err.name, stack: err.stack}
}

module.exports = function (opts) {
  return new PacketStream(opts)
}

function PacketStream (opts) {
  this.ended = false
  this.opts  = opts // must release, may capture `this`

  this._req_counter = 1
  this._requests    = {} // must release, may capture `this`
  this._instreams   = {} // must release, may capture `this`
  this._outstreams  = {} // must release, may capture `this`
  this._closecbs    = [] // must release, may capture `this`
  this._closing     = false
  this._closed      = false
  if (opts.close)
    this._closecbs.push(opts.close)
}

// Sends a single message to the other end
PacketStream.prototype.message = function (obj) {
  this.read({req: 0, stream: false, end: false, value: obj})
}

// Sends a message to the other end, expects an (err, obj) response
PacketStream.prototype.request = function (obj, cb) {
  if (this._closing) return cb(new Error('parent stream is closing'))
  var rid = this._req_counter++
  var self = this
  this._requests[rid] = function (err, value) {
    delete self._requests[rid]
    cb(err, value)
    self._maybedone()
  }
  this.read({ req:rid, stream: false, end: false, value: obj })
}

// Sends a request to the other end for a stream
PacketStream.prototype.stream = function () {
  if (this._closing) throw new Error('parent stream is closing')
  var rid = this._req_counter++
  var self = this
  this._outstreams[rid] = new PacketStreamSubstream(rid, this, function() { delete self._outstreams[rid] })
  return this._outstreams[rid]
}

// Marks the packetstream to close when all current IO is finished
PacketStream.prototype.close = function (cb) {
  if(!cb) throw new Error('packet-stream.close *must* have callback')
  if (this._closed)
    return cb()
  this._closecbs.push(cb)
  this._closing = true
  this._maybedone()
}

// Forces immediate close of the PacketStream
// - usually triggered by an `end` packet from the other end
PacketStream.prototype.destroy = function (end) {
  end = end || flat(end)
  this.ended = end
  this._closing = true

  var err = (end === true)
    ? new Error('unexpected end of parent stream')
    : end

  // force-close all requests and substreams
  var numended = 0
  for (var k in this._requests)   { numended++; this._requests[k](err) }
  for (var k in this._instreams)  {
    numended++
    // destroy substream without sending it a message
    this._instreams[k].writeEnd = true
    this._instreams[k].destroy(err)
  }
  for (var k in this._outstreams) {
    numended++
    // destroy substream without sending it a message
    this._outstreams[k].writeEnd = true
    this._outstreams[k].destroy(err)
  }

  //from the perspective of the outside stream it's not an error
  //if the stream was in a state that where end was okay. (no open requests/streams)
  if (numended === 0 && end === true)
    err = null
  this._maybedone(err)
}

PacketStream.prototype._maybedone = function (err) {
  if (this._closed || !this._closing)
    return

  // check if all requests and streams finished
  if (Object.keys(this._requests).length !== 0 ||
      Object.keys(this._instreams).length !== 0 ||
      Object.keys(this._outstreams).length !== 0)
    return // not yet

  // close
  this._closed = true
  this._closecbs.forEach(function (cb) { cb(err) })
  this.read(null, err || true)

  // deallocate
  this.opts = null
  this._closecbs.length = 0
  this.read = closedread
}

function closedread (msg) {
  console.error('packet-stream asked to read after closed', msg)
}

// Sends data out to the other end
// - to be overridden by the PacketStream consumer
PacketStream.prototype.read = function (msg) {
  console.error('please overwrite read method to do IO', msg)
}

// Accepts data from the other end
PacketStream.prototype.write = function (msg, end) {
  if (this.ended)
    return

  if (end)                         this.destroy(end)
  else if (msg.req && !msg.stream) this._onrequest(msg)
  else if (msg.req && msg.stream)  this._onstream(msg)
  else                             this._onmessage(msg)
}

// Internal handler of incoming message msgs
PacketStream.prototype._onmessage = function (msg) {
  if (this.opts && 'function' === typeof this.opts.message)
    this.opts.message(msg.value)
}

// Internal handler of incoming request msgs
PacketStream.prototype._onrequest = function (msg) {
  var rid = msg.req*-1
  if(msg.req < 0) {
    // A incoming response
    if (typeof this._requests[rid] == 'function')
      this._requests[rid](
        msg.end ? msg.value: null,
        msg.end ? null : msg.value
      )
  }
  else {
    // An incoming request
    if (this.opts && typeof this.opts.request == 'function') {
      var once = false
      var self = this
      this.opts.request(msg.value, function (err, value) {
        if(once) throw new Error('cb called twice from local api')
        once = true
        if(err) self.read({ value: flat(err), end: true, req: rid })
        else    self.read({ value: value, end: false, req: rid })
        self._maybedone()
      })
    } else {
      if (this.ended) {
        var err = (this.ended === true)
          ? new Error('unexpected end of parent stream')
          : this.ended
        this.read({ value: flat(err), end: true, stream: false, req: rid })
      }
      else
        this.read({ value: {
            message: 'Unable to handle requests',
            name: 'NO_REQUEST_HANDLER', stack: null
          },
          end: true, stream: false, req: rid
        })
      this._maybedone()
    }
  }
}

// Internal handler of incoming stream msgs
PacketStream.prototype._onstream = function (msg) {
  if(msg.req < 0) {
    // Incoming stream data
    var rid = msg.req*-1
    var outs = this._outstreams[rid]
    if (!outs)
      return console.error('no stream for incoming msg', msg)

    if (msg.end) {
      if (outs.writeEnd)
        delete this._outstreams[rid]
      outs.readEnd = true
      outs.read(null, msg.value)
      this._maybedone()
    }
    else
      outs.read(msg.value)
  }
  else {
    // Incoming stream request
    var rid = msg.req
    var ins = this._instreams[rid]

    if (!ins) {
      // New stream
      var self = this
      ins = this._instreams[rid] = new PacketStreamSubstream(rid*-1, this, function() { delete self._instreams[rid] })
      if (this.opts && typeof this.opts.stream == 'function')
        this.opts.stream(ins)
    }

    if (!ins.read)
      return console.error('no .read for stream:', ins.id, 'dropped:', msg)

    if (msg.end) {
      if (ins.writeEnd)
        delete this._instreams[rid]
      ins.readEnd = true
      ins.read(null, msg.value)
      this._maybedone()
    }
    else
      ins.read(msg.value)
  }
}


function PacketStreamSubstream (id, ps, remove) {
  this.id       = id
  this.read     = null // must release, may capture `this`
  this.writeEnd = null
  this.readEnd  = null

  this._ps          = ps     // must release, may capture `this`
  this._remove      = remove // must release, may capture `this`
  this._seq_counter = 1
}

PacketStreamSubstream.prototype.write = function (data, err) {
  if (err) {
    this.writeEnd = err
    var ps = this._ps
    if (ps) {
      ps.read({ req: this.id, stream: true, end: true, value: flat(err) })
      if (this.readEnd)
        this.destroy()
      ps._maybedone()
    }
  }
  else {
    if (this._ps) this._ps.read({ req: this.id, stream: true, end: false, value: data })
  }
}

// Send the `end` message for the substream
PacketStreamSubstream.prototype.end = function (err) {
  this.write(null, flat(err || true))
}

PacketStreamSubstream.prototype.destroy = function (err) {
  if (!this.writeEnd) {
    this.writeEnd = true
    if (!this.readEnd) {
      this.readEnd = true
      try {
        // catch errors to ensure cleanup
        this.read(null, err)
      } catch (e) {
        console.error('Exception thrown by PacketStream substream end handler', e)
        console.error(e.stack)
      }
    }
    this.write(null, err)
  }
  else if (!this.readEnd) {
    this.readEnd = true
    try {
      // catch errors to ensure cleanup
      this.read(null, err)
    } catch (e) {
      console.error('Exception thrown by PacketStream substream end handler', e)
      console.error(e.stack)
    }
  }

  // deallocate
  if (this._ps) {
    this._remove()
    this._remove = null
    this.read = closedread
    this._ps = null
  }
}

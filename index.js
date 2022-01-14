const PacketStreamSubstream = require('./substream')
const {flat, closedread} = require('./utils')

function PacketStream (opts) {
  this.ended = false
  this.opts  = opts // must release, may capture `this`

  this._req_counter = 1
  this._requests    = new Map() // must release, may capture `this`
  this._instreams   = new Map() // must release, may capture `this`
  this._outstreams  = new Map() // must release, may capture `this`
  this._closecbs    = []        // must release, may capture `this`
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
  const rid = this._req_counter++
  this._requests.set(rid, (err, value) => {
    this._requests.delete(rid)
    cb(err, value)
    this._maybedone(err)
  })
  this.read({ req: rid, stream: false, end: false, value: obj })
}

// Sends a request to the other end for a stream
PacketStream.prototype.stream = function () {
  if (this._closing) throw new Error('parent stream is closing')
  const rid = this._req_counter++
  const outs = new PacketStreamSubstream(rid, this, () => {
    this._outstreams.delete(rid)
  })
  this._outstreams.set(rid, outs)
  return outs
}

// Marks the packetstream to close when all current IO is finished
PacketStream.prototype.close = function (cb) {
  if (!cb) throw new Error('packet-stream.close *must* have callback')
  if (this._closed) return cb()
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

  let err = (end === true)
    ? new Error('unexpected end of parent stream')
    : end

  // force-close all requests and substreams
  let numended = 0
  this._requests.forEach((fn) => {
    numended++;
    fn(err)
  })
  this._instreams.forEach((ins) => {
    numended++;
    // destroy substream without sending it a message
    ins.writeEnd = true
    ins.destroy(err)
  })
  this._outstreams.forEach((outs) => {
    numended++
    // destroy substream without sending it a message
    outs.writeEnd = true
    outs.destroy(err)
  })

  //from the perspective of the outside stream it's not an error
  //if the stream was in a state that where end was okay. (no open requests/streams)
  if (numended === 0 && end === true) err = null
  this._maybedone(err)
}

PacketStream.prototype._maybedone = function (err) {
  if (this._closed || !this._closing)
    return

  // check if all requests and streams finished
  if (this._requests.size !== 0 ||
      this._instreams.size !== 0 ||
      this._outstreams.size !== 0)
    return // not yet

  // close
  this.read(null, err || true)
  this._closed = true
  this._closecbs.forEach((cb) => { cb(err) })

  // deallocate
  this.opts = null
  this._closecbs.length = 0
  this.read = closedread
  this._requests.clear()
  this._instreams.clear()
  this._outstreams.clear()
}

// Sends data out to the other end
// - to be overridden by the PacketStream consumer
PacketStream.prototype.read = function (msg) {
  console.error('please overwrite read method to do IO', msg)
}

// Accepts data from the other end
PacketStream.prototype.write = function (msg, end) {
  if (this.ended) return

  if (end)                         this.destroy(end)
  else if (msg.req && !msg.stream) this._onrequest(msg)
  else if (msg.req && msg.stream)  this._onstream(msg)
  else                             this._onmessage(msg)
}

// Internal handler of incoming message msgs
PacketStream.prototype._onmessage = function (msg) {
  if (this.opts && typeof this.opts.message === 'function')
    this.opts.message(msg.value)
}

// Internal handler of incoming request msgs
PacketStream.prototype._onrequest = function (msg) {
  const rid = msg.req*-1
  if (msg.req < 0) {
    // A incoming response
    if (this._requests.has(rid))
      this._requests.get(rid)(
        msg.end ? msg.value : null,
        msg.end ? null : msg.value
      )
  }
  else {
    // An incoming request
    if (this.opts && typeof this.opts.request === 'function') {
      let once = false
      this.opts.request(msg.value, (err, value) => {
        if (once) throw new Error('cb called twice from local api')
        once = true
        if (err) this.read({ value: flat(err), end: true, req: rid })
        else     this.read({ value: value, end: false, req: rid })
        this._maybedone()
      })
    } else {
      if (this.ended) {
        // FIXME: this block seems unreachable because of line 131
        const err = (this.ended === true)
          ? new Error('unexpected end of parent stream')
          : this.ended
        this.read({ value: flat(err), end: true, stream: false, req: rid })
      } else {
        this.read({
          value: {
            message: 'Unable to handle requests',
            name: 'NO_REQUEST_HANDLER', stack: null
          },
          end: true, stream: false, req: rid
        })
      }
      this._maybedone()
    }
  }
}

// Internal handler of incoming stream msgs
PacketStream.prototype._onstream = function (msg) {
  if (msg.req < 0) {
    // Incoming stream data
    const rid = msg.req * -1
    const outs = this._outstreams.get(rid)
    if (!outs)
      return console.error('no stream for incoming msg', msg)

    if (msg.end) {
      if (outs.writeEnd)
        this._outstreams.delete(rid)
      outs.readEnd = true
      outs.read(null, msg.value)
      this._maybedone()
    }
    else {
      if (outs.writeEnd) {
        // Drop data received after wrote end
      } else {
        outs.read(msg.value)
      }
    }
  }
  else {
    // Incoming stream request
    const rid = msg.req
    let ins = this._instreams.get(rid)

    if (!ins) {
      // New stream
      ins = new PacketStreamSubstream(rid * -1, this, () => {
        this._instreams.delete(rid)
      })
      this._instreams.set(rid, ins)
      if (this.opts && typeof this.opts.stream === 'function')
        this.opts.stream(ins)
    }

    if (msg.end) {
      if (ins.writeEnd)
        this._instreams.delete(rid)
      ins.readEnd = true
      if (ins.read)
        ins.read(null, msg.value)
      this._maybedone()
    }
    else if (ins.read)
      if (ins.writeEnd) {
        // Drop data received after wrote end
      } else {
        ins.read(msg.value)
      }
    else
      console.error('no .read for stream:', ins.id, 'dropped:', msg)
  }
}

module.exports = (opts) => new PacketStream(opts)

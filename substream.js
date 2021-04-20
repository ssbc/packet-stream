var utils = require('./utils')
var flat = utils.flat
var closedread = utils.closedread

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
        this.destroy(err)
      ps._maybedone(err)
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
      // don't assume that a stream has been piped anywhere.
      if(this.read) this.read(null, err)
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

module.exports = PacketStreamSubstream
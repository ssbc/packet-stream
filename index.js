function flat(err) {
  if(!err) return err
  if(err === true) return true
  return {message: err.message, stack: err.stack}
}

module.exports = function (opts, name) {
  var req = 1, p, todo = 0, done = 0, closing = null, closed = false

  var requests = [], instreams = [], outstreams = []

  function onMessage (msg) {
    opts.message(msg)
  }

  function onRequest (msg) {
    //call the local api.
    if(msg.req < 0)
      requests[msg.req*-1](msg.error, msg.value)
    else {
      var id = msg.req*-1, once = false
      //must callback exactly once.
      //any extra callbacks are just ignored.
      todo ++
      opts.request(msg.value, function (err, value) {
        if(once) throw new Error('cb called twice from local api')
        once = true
        done ++
        if(err) p.read({error: flat(err), req: id})
        else    p.read({value: value, req: id})
        maybeDone()
      })
    }
  }

  function createStream(id) {
    var seq = 1
    todo += 2
    var stream = {
      id: id,
      writeEnd: false,
      readEnd: false,
      write: function (data, err) {
        if(err) {
          stream.writeEnd = err; done ++
          p.read({req: id, seq: seq++, end: flat(err)})
          maybeDone()
        }
        else
          p.read({req: id, seq: seq++, value: data})
      },
      end: function (err) {
        stream.write(null, flat(err || true))
      },
      destroy: function (err) {
        if(!stream.writeEnd) {
          stream.writeEnd = false
          done ++
          if(!stream.readEnd) {
            done ++
            stream.readEnd = false
            stream.read(null, err)
          }
          stream.write(null, err)
        }
        else if (!stream.readEnd) {
          stream.readEnd = false
          done++
          stream.read(null, err)
        }
      },
      read: null
    }

    return stream
  }

  function onStream (msg) {
    if(msg.req < 0) { // it's a response
      var outs = outstreams[msg.req*-1]
      if(msg.end) {
        done ++
        delete outstreams[msg.req*-1]
        outs.readEnd = true
        outs.read(null, msg.end)
        maybeDone()
      }
      else
        outs.read(msg.value)
    }
    else {
      var ins = instreams[msg.req]
      if(ins) {
        if(ins.read) {
          if(msg.end) {
            done ++
            delete instreams[msg.req]
            ins.readEnd = true
            ins.read(null, msg.end)
            maybeDone()
          }
          else
            ins.read(msg.value)
        }
        else console.error('no .read for stream:', ins.id, 'dropped:', msg)
      }
      else {
        var seq = 1, req = msg.req
        var stream = instreams[req] = createStream(req*-1)
        opts.stream(stream)
        if(msg.end) {
          done ++;
          delete instreams[req]
          stream.read(null, msg.end)
          maybeDone()
        }
        else
          stream.read(msg.value)
      }
    }
  }

  function maybeDone () {
    if(!closing) return
    if(todo !== done) return
    closed = true

    var _closing = closing
    closing = null
    _closing()
    p.read(null, true)
  }

  return p = {
    close: function (cb) {
      if(!cb) throw new Error('packet-stream.close *must* have callback')
      closing = cb
      maybeDone()
    },
    ended: false,
    //message with no response, or stream
    message: function (obj) {
      p.read(obj)
    },

    request: function (obj, callback) {
      var id = req++
      todo ++
      requests[id] = function (err, value) {
        delete requests[id]
        done ++
        callback(err, value)
        maybeDone()
      }
      p.read({value: obj, req: id})
    },

    stream: function (recv) {
      var id = req++
      return outstreams[id] = createStream(id)
    },

    read: function (msg) {
      console.error('please overwrite write method to do IO', msg)
    },

    write: function (msg, end) {
      if(p.ended) return
      //handle requests
      if(end) return p.destroy(end)

      ; (msg.req && !msg.seq) ? onRequest(msg)
      : (msg.req && msg.seq)  ? onStream(msg)
      :                         onMessage(msg)
    },
    destroy: function (end) {
      end = end || flat(end)
      p.ended = end
      var err = end === true
        ? new Error('unexpected end of parent stream')
        : end

      requests.forEach(function (cb) { done++; cb(err) })
      instreams.forEach(function (s, id) {
        delete instreams[id]
        s.destroy(err)
      })
      outstreams.forEach(function (s, id) {
        delete outstreams[id]
        s.destroy(err)
      })
      maybeDone()
      return
    }
  }
}

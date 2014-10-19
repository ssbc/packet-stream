function flat(err) {
  if(!err) return err
  if(err === true) return true
  return {message: err.message, stack: err.stack}
}

module.exports = function (opts) {
  var req = 1, p

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

      opts.request(msg.value, function (err, value) {
        if(once) throw new Error('cb called twice from local api')
        once = true
        if(err) p.read({error: flat(err), req: id})
        else    p.read({value: value, req: id})
      })
    }
  }

  function createStream(id) {
    var seq = 1
    var stream = {
      id: id,
      write: function (data, err) {
        p.read({req: id, seq: seq++, value: data, end: flat(err)})
      },
      end: function (err) {
        stream.write(null, flat(err || true))
      },
      read: null
    }

    return stream
  }

  function onStream (msg) {

    if(msg.req < 0) { // it's a response
      var outs = outstreams[msg.req*-1]
      if(msg.end) {
        delete outstreams[msg.req*-1]
        outs.read(null, msg.end)
      }
      else
        outs.read(msg.value)
    }
    else {
      var ins = instreams[msg.req]
      if(ins) {
        if(ins.read) {
          if(msg.end) {
            instreams[msg.req] = null
            ins.read(null, msg.end)
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
        if(msg.end) delete instreams[req]
        stream.read(msg.value, msg.end)
      }
    }

  }

  return p = {
    ended: false,
    //message with no response, or stream
    message: function (obj) {
      p.read(obj)
    },

    request: function (obj, callback) {
      var id = req++
      requests[id] = function (err, value) {
        delete requests[id]
        callback(err, value)
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
      if(end) {
        end = end || flat(end)
        p.ended = end
        var err = end === true
          ? new Error('unexpected end of parent stream')
          : end

        requests.forEach(function (cb) { cb(err) })
        instreams.forEach(function (s, id) {
          delete instreams[id]
          if(s.read) s.read(null, err)
        })
        outstreams.forEach(function (s, id) {
          delete outstreams[id]
          if(s.read)s.read(null, err)
        })
        return
      }
      //handle requests
      ; (msg.req && !msg.seq) ? onRequest(msg)
      : (msg.req && msg.seq)  ? onStream(msg)
      :                         onMessage(msg)
    }
  }
}

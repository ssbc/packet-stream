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
        if(err) p.read({error: err.message, req: id})
        else    p.read({value: value, req: id})
      })
    }
  }

  function onStream (msg) {

    if(msg.req < 0) // it's a response
      outstreams[msg.req*-1].read(msg.value)

    else {
      var ins = instreams[msg.req]
      if(ins) {
        if(ins.read) ins.read(msg.value)
        else console.error('no .read for stream:', ins.id, 'dropped:', msg)
      }
      else {
        var seq = 1, req = msg.req
        var stream = instreams[req] = {
          id: req,
          write: function (data) {
            p.read({req: req*-1, seq: seq++, value: data})
          },
          read: null
        }
        opts.stream(stream)
        stream.read(msg.value)
      }
    }

  }

  return p = {
    //message with no response, or stream
    message: function (obj) {
      p.read(obj)
    },

    request: function (obj, callback) {
      var id = req++
      requests[id] = function (err, value) {
        requests[id] = null
        callback(err, value)
      }
      p.read({value: obj, req: id})
    },

    stream: function (recv) {
      var id = req++, seq = 1
      return outstreams[id] = {
        req: id,
        write: function (data) {
          p.read({
            req: id, seq: seq++, value: data
          })
        },
        read: recv || null
      }
    },

    read: function (msg) {
      console.error('please overwrite write method to do IO', msg)
    },

    write: function (msg) {
      //handle requests
      if(msg.req && !msg.seq)
        onRequest(msg)
      else if(msg.req && msg.seq)
        onStream(msg)
      else
        onMessage(msg)
    }
  }
}

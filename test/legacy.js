var tape = require('tape')

var ps = require('../')

tape('abort streams if receive "unexpected end of parent stream"', function (t) {
  t.plan(6)

  var s1a, s2a
  var a = ps({
    stream: function (stream) {
      if(!s1a) {
        s1a = stream
        s1a.read = function (data, end) {
          if(data) t.ok(data, 's1a got data')
          else t.ok(end, 's1a ended')
        }
      } else if(!s2a) {
        s2a = stream
        s2a.read = function (data, end) {
          if(data) t.ok(data, 's2a got data')
          else t.ok(end, 's2a ended')
        }
      } else {
        t.fail('too many substreams')
      }
    }
  })

  var b = ps({})
  a.read = b.write.bind(b); b.read = a.write.bind(a)

  var s1b = b.stream()
  s1b.read = function (data, end) {
    t.ok(end, 's1 ended')
  }

  var s2b = b.stream()
  s2b.read = function (data, end) {
    t.ok(end, 's2 ended')
  }

  // send data to open the streams
  s1b.write('hi')
  s2b.write('hi')

  // simulate packet-stream <= 2.0.0 starting to destroy the parent stream
  s1b.write(null, new Error('unexpected end of parent stream'))
})

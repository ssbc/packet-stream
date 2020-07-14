
var tape = require('tape')

var ps = require('../')

tape('messages', function (t) {

  var actual = []

  var a = ps({
    message: function (msg) {
      console.log('MSG', msg)
      actual.push(msg)
    }
  })

  var b = ps({})

  // a.pipe(b).pipe(a)
  a.read = b.write.bind(b); b.read = a.write.bind(a)

  var expected = ['hello', 'foo', 'bar']

  expected.forEach(b.message.bind(b))
  t.deepEqual(actual, expected)

  t.end()
})

tape('request-response', function (t) {

  var a = ps({
    request: function (value, cb) {
      cb(null, value * 2)

      //calling a second time should throw.
      try { cb() } catch (err) { t.end() }
    }
  })

  var b = ps({})

  a.read = b.write.bind(b); b.read = a.write.bind(a)

  b.request(7, function (err, value) {
    t.notOk(err)
    t.equal(value, 14)
  })

})

tape('stream', function (t) {

  var actual = [], expected = [1, 2, 3, 4, 5]

  var a = ps({
    stream: function (stream) {
      //echo server
      stream.read = stream.write.bind(stream)
    }
  })
  var b = ps({})
  a.read = b.write.bind(b); b.read = a.write.bind(a)

  var s = b.stream()
  s.read = function (data, end) {
    if(!end)
      actual.push(data)
    else
      t.end()
  }

  expected.forEach(function (data) {
    s.write(data)
  })

  t.deepEqual(actual, expected)

  s.end()

})

tape('error async when stream ends', function (t) {

  var a = ps({})

  a.request({foo: true}, function (err) {
    t.ok(err)
    t.equal(a.ended, true)
    t.end()
  })
  t.equal(a.ended, false)
  a.write(null, true)
})

tape('close after request finishes', function (t) {

  t.plan(2)

  var called = false
  var a = ps({
    request: function (value, cb) {
      setTimeout(function () {
        cb(null, value * 2)
      })
    }
  })

  var b = ps({})

  a.read = b.write.bind(b); b.read = a.write.bind(a)

  b.request(7, function (err, value) {
    t.notOk(err)
    t.equal(value, 14)
    called = true
  })

  b.close(function (err) {
    if (!called)
      throw "not called"
    t.end()
  })

})

tape('streams, close', function (t) {
  t.plan(7)
  var expected = [1,2,3,3,5]

  var a = ps({
    stream: function (stream) {
      //echo server
      stream.read = function (data, end) {
        setImmediate(function () {
          stream.write(data, end)
        })
      }
    }
  })
  var b = ps({})
  var s = b.stream()
  a.read = b.write.bind(b); b.read = a.write.bind(a)

  b.close(function (err) {
    t.ok(true)
    t.end()
  })

  s.read = function (data, end) {
    if(end) t.ok(end)
    else    t.equal(data, expected.shift())
  }

  expected.forEach(function (d) {
    s.write(d)
  })
  s.write(null, true)

})

tape('receive stream, then close', function (t) {
  t.plan(7)
  var a = ps({
    stream: function (stream) {
      //echo server
      stream.read = function (data, end) {
        setImmediate(function () {
          stream.write(data, end)
        })
      }

      a.close(function (err) {
        console.log('close reached', err)
        t.ok(true)
        t.end()
      })

    }
  })

  var expected = [1,2,3,3,5]

  var b = ps({})
  var s = b.stream()
  a.read = b.write.bind(b); b.read = a.write.bind(a)

  s.read = function (data, end) {
    if(end && end !== true) throw end
    if(end) t.ok(end)
    else    t.equal(data, expected.shift())
  }

  expected.forEach(function (d) {
    s.write(d)
  })

  s.write(null, true)

})

tape('call close cb with err when the stream has errored', function (t) {
  var err = new Error('test error')
  var a = ps({
    close: function (_err) {
      t.equal(_err, err)
      t.end()
    }
  })

  a.write(null, err)
})

tape('call close cb when the stream is ended', function (t) {
  var a = ps({
    close: function (_err) {
      t.equal(_err, null)
      t.end()
    }
  })

  a.write(null, true)
})


tape('double close', function (t) {

  var a = ps({
    close: function (err) {
      console.log('close', err)
    }
  })

  console.log('close 1')
  a.close(function () {
  console.log('close 2')
    a.close(function () {
      t.end()
    })
  })
})

tape('properly close if destroy called with a open request', function (t) {

  var a = ps({
    request: function (value, cb) {
      // never calls cb
    }
  })

  var b = ps({
    close: function (err) {
      console.log('close')
      t.end()
    }
  })

  a.read = b.write.bind(b); b.read = a.write.bind(a)

  b.request(7, function (err, value) {
    console.log(err)
  })

  b.destroy(true)

})

tape('destroy sends not more than one message', function (t) {
  var a = ps({
    close: function (err) {
      t.end()
    }
  })

  var msgs = 0
  a.read = function (msg, end) {
    if (end) return t.ok(end)
    msgs++
    if (msgs > 1) t.fail(msgs)
    else t.ok(msg)
  }

  var s1 = a.stream()
  var s2 = a.stream()
  s1.read = function () {}
  s2.read = function () {}

  a.destroy(true)
})

tape('ensure properly close if destroy called with a open request', function (t) {

  const expectedError = new Error('a sudden but inevitable close')

  var a = ps({
    request: function (value, cb) {
      // never calls cb
    }
  })

  var b = ps({
    close: function (err) {
      t.deepEquals(err, expectedError, 'close err matches')
      t.end()
    }
  })

  a.read = b.write.bind(b); b.read = a.write.bind(a)

  b.request(7, function (err, value) {
    t.deepEquals(err, expectedError, 'request err matches')
  })

  b.destroy(expectedError)
})

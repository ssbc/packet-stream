
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
  a.read = b.write; b.read = a.write

  var expected = ['hello', 'foo', 'bar']

  expected.forEach(b.message)
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

  a.read = b.write; b.read = a.write

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
      stream.read = stream.write
    }
  })

  var b = ps({})

  a.read = b.write; b.read = a.write

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

tape('request-response', function (t) {

  t.plan(2)

  var a = ps({
    request: function (value, cb) {
      setTimeout(function () {
        cb(null, value * 2)
      })
      //calling a second time should throw.
    }
  })

  var b = ps({})

  a.read = b.write; b.read = a.write

  b.request(7, function (err, value) {
    t.notOk(err)
    t.equal(value, 14)
  })

  b.close(function (err) {
    t.end()
  })

})

tape('streams, close', function (t) {
  t.plan(7)
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

  var expected = [1,2,3,3,5]

  var b = ps({})

  var s = b.stream()

  a.read = b.write; b.read = a.write

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
        t.ok(true)
        t.end()
      })

    }
  })

  var expected = [1,2,3,3,5]

  var b = ps({})

  var s = b.stream()

  a.read = b.write; b.read = a.write

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

tape('call close cb when the stream is ended', function (t) {
  var err = new Error('test error')
  var a = ps({
    close: function (_err) {
      t.equal(_err, err)
      t.end()
    }
  })

  a.write(null, err)
})


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
      console.log('CONNECTION')
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
    t.end()
  })

  a.write(null, true)
})

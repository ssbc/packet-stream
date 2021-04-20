const cont = require('cont')
const ps = require('../')

console.log("name, ops, opts/second, seconds")
function Timer (name) {
  var start = Date.now()
  return function (ops) {
    var seconds = (Date.now() - start)/1000
    console.log([name, ops, ops/seconds, seconds].join(', '))
  }
}

function bunch_of_substreams (N, _, cb) {
  var items = Array(200).fill(0).map((_, i) => i * 10)

  var a = ps({
    stream: function (stream) {
      //echo server
      stream.read = stream.write.bind(stream)
    }
  })
  var b = ps({})
  a.read = b.write.bind(b); b.read = a.write.bind(a)

  for (var i = 0; i < N; i++) {
    var s = b.stream()
    s.read = function (data, end) {
    }
    items.forEach(function (data) {
      s.write(data)
    })
    s.end()
  }

  cb(null, N)
}

var N = 150e3

function run(name, benchmark, opts) {
  return function (cb) {
    var t = Timer(name)
    benchmark(N, opts, function (err, n) {
      t(err || n)
      cb()
    })
  }
}

cont.series([
  run('bunch_of_substreams', bunch_of_substreams),
]) (function () {
  // teardown logic here
})
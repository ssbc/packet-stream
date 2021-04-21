function flat(err) {
  if (!err) return err
  if (err === true) return true
  return {message: err.message, name: err.name, stack: err.stack}
}

function closedread (msg) {
  console.error('packet-stream asked to read after closed', msg)
}

module.exports = {
  flat: flat,
  closedread: closedread
}
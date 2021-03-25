const readline = require('readline')
const fs = require('fs')
const packer = require('msgpack5')()
const _ = require('lodash')
const stringify = require('csv-stringify')
const assert = require('assert')

const lineReader = readline.createInterface({
  input: fs.createReadStream('./msgs.log')
})

const all = []

lineReader.on('line', function (line) {
//   console.log('Line from file:', line.length)
  const buf = Buffer.from(line, 'base64')
  //   console.log('Buffer length:', buf.length)
  const arr = packer.decode(buf)
  console.log('Array length:', arr.length)
  const chunked = _.chunk(arr, 3)
  console.log('Chunked array length:', chunked.length)
  all.push(...chunked)
  console.log('All length:', all.length)
})

lineReader.on('close', function () {
  console.log('Close called')
  stringify(all, { header: true, columns: ['posX', 'posY', 'depth'] }, function (err, output) {
    assert.ifError(err)
    fs.writeFileSync('digs.csv', output)
  })
})

const fs = require('fs');
const readline = require('readline');
const { convertArrayToCSV } = require('convert-array-to-csv');

const map = Array.from(Array(3500), () => (new Array(3500)).fill(0))
let count = 0
async function processLineByLine() {
  const fileStream = fs.createReadStream('treasuresStats.log');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  // Note: we use the crlfDelay option to recognize all instances of CR LF
  // ('\r\n') in input.txt as a single line break.

  for await (const line of rl) {
    // Each line in input.txt will be successively available here as `line`.
    for (const item of JSON.parse(line)) {
        // console.log("Item:", item);
        map[item[0]][item[1]] = item[2]
        count++
    }
  }

  console.log(count, map[1797][236], map[1795][1324])
  fs.writeFileSync('stats.csv', convertArrayToCSV(map))
//   console.log(JSON.stringify(map))
}

processLineByLine();
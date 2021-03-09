const fs = require('fs');
const readline = require('readline');

const all = [];
let count = 0;
async function processLineByLine() {
  const fileStream = fs.createReadStream('unique.csv');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  // Note: we use the crlfDelay option to recognize all instances of CR LF
  // ('\r\n') in input.txt as a single line break.

  for await (const line of rl) {
    // Each line in input.txt will be successively available here as `line`.
    // for (const item of JSON.parse(line)) {
    // console.log("Item:", item);
    if (count !== 0) all.push(line.split(',').map(Number));
    count++;
    // }
  }

  console.log(count, all[0], all[1]);
  // all.sort((a, b) => Math.sign(a[0] - b[0]) + Math.sign(a[1] - b[1]))
  // console.log(count, all[0], all[1])
  for (let i = 0; i < 4; i++) {
    const arr = all.splice(0, 3047);
    fs.writeFileSync(`dig${i}.json`, JSON.stringify(arr));
  }
  console.log(all);
}

processLineByLine();

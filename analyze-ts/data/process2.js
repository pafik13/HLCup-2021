const fs = require('fs');
const readline = require('readline');
const {convertArrayToCSV} = require('convert-array-to-csv');

const all = [];
let count = 0;
async function processLineByLine() {
  const fileStream = fs.createReadStream('treasuresStats.log');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  // Note: we use the crlfDelay option to recognize all instances of CR LF
  // ('\r\n') in input.txt as a single line break.

  for await (const line of rl) {
    // Each line in input.txt will be successively available here as `line`.
    for (const item of JSON.parse(line)) {
      // console.log("Item:", item);
      all.push(item);
      count++;
    }
  }

  console.log(count, all[0], all[1]);
  all.sort((a, b) => Math.sign(a[0] - b[0]) + Math.sign(a[1] - b[1]));
  console.log(count, all[0], all[1]);
  fs.writeFileSync(
    'all.csv',
    convertArrayToCSV(all, {
      header: ['posX', 'posY', 'depth', 'count'],
    })
  );
}

processLineByLine();

// odd_indexes < -seq(1, 17862, 2);
// even_indexes < -seq(2, 17862, 2);

// tapply(DT2$avgCount, DT2$depth, summary);

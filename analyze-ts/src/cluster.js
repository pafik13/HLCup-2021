const cluster = require('cluster');
// const http = require('http');
// const numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  const worker = cluster.fork();
  worker.send('hi there');
} else if (cluster.isWorker) {
  process.on('message', msg => {
    console.log(msg);
  });
}

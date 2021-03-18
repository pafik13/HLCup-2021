type Area = {
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
};

type Explore = {
  priority?: number;
  area: Area;
  amount: number;
};

type GlobalStats = {
  dnsLookup: number[];
  tcpConnection: number[];
  firstByte: number[];
  contentTransfer: number[];
  total: number[];
};

type StepStats = {
  licenseAndExplore: number[];
  explore: number[];
  exploreAmount: number[];
  digging: number[];
  refreshLicense: number[];
};

type License = {
  id: number;
  digAllowed: number;
  digUsed: number;
};

import {request, RequestOptions} from 'http';
import {performance} from 'perf_hooks';
import {inspect} from 'util';
import * as ss from 'simple-statistics';
import PQueue from 'p-queue';
import * as cluster from 'cluster';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  console.debug(process.versions);

  // Fork workers.
  for (let i = 0; i < 4; i++) {
    const worker = cluster.fork();
    worker.send({instanceId: i});
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
    console.log(`code: ${code}, signal: ${signal}`);
  });
} else {
  process.on('message', msg => {
    const instanceId = Number(msg.instanceId);

    const baseURL = `http://${process.env.ADDRESS}:8000`;
    const GLOBAL_OFFSET_X = Number(process.env.GLOBAL_OFFSET_X) || 0;
    const GLOBAL_OFFSET_Y = Number(process.env.GLOBAL_OFFSET_Y) || 0;
    const EXPLORE_CONCURRENCY = Number(process.env.EXPLORE_CONCURRENCY) || 1;
    const EXPLORE_SIZE = Number(process.env.EXPLORE_SIZE) || 16;
    const PRINT_STATS_TIME = Number(process.env.PRINT_STATS_TIME) || 60000;
    const PQCASH_CONCURRENCY = Number(process.env.PQCASH_CONCURRENCY) || 1;
    const STATS_INSTANCE_ID = Number(process.env.STATS_INSTANCE_ID) || 1;
    console.debug(
      'envs: ',
      baseURL,
      GLOBAL_OFFSET_X,
      GLOBAL_OFFSET_Y,
      EXPLORE_CONCURRENCY,
      EXPLORE_SIZE,
      PRINT_STATS_TIME,
      PQCASH_CONCURRENCY,
      STATS_INSTANCE_ID
    );

    const pqCash = new PQueue({concurrency: PQCASH_CONCURRENCY});

    const globalStats: Record<string, GlobalStats> = {};
    const stepStats: StepStats = {
      licenseAndExplore: [],
      explore: [],
      exploreAmount: [],
      digging: [],
      refreshLicense: [],
    };

    const areas: Area[] = [];
    const explores: Explore[] = [];

    const exploreStats = {
      tries: 0,
      amount: 0,
    };

    class CallStats {
      public count: Record<number, number> = {};
      public time: Record<number, number> = {};

      setTime = (status: number, time: number): void => {
        if (this.time[status]) {
          this.time[status] += time;
        } else {
          this.time[status] = time;
        }
        if (this.count[status]) {
          this.count[status]++;
        } else {
          this.count[status] = 1;
        }
      };

      [inspect.custom]() {
        let countStr = '';
        for (const [key, value] of Object.entries(this.count)) {
          countStr += `${key}: ${value}; `;
        }
        let timeStr = '';
        for (const [key, value] of Object.entries(this.time)) {
          timeStr += `${key}: ${value.toFixed(2)}; `;
        }
        return `[${countStr}; ${timeStr}]`;
      }
    }

    const callStats = {
      explore: new CallStats(),
      dig: new CallStats(),
      cash: new CallStats(),
      licenseFree: new CallStats(),
      licensePaid: new CallStats(),
    };

    const summary = function (input: number[]) {
      return `${ss.min(input).toFixed(2)} ${ss
        .quantile(input, 0.2)
        .toFixed(2)} ${ss.median(input).toFixed(2)} ${ss
        .mean(input)
        .toFixed(2)} ${ss.quantile(input, 0.8).toFixed(2)} ${ss
        .max(input)
        .toFixed(2)} ${ss.sum(input).toFixed(2)} ${input.length}`;
    };

    const writeStats = function () {
      if (instanceId !== STATS_INSTANCE_ID) return;
      console.debug(
        exploreStats,
        pqCash.size,
        areas.length,
        explores.length,
        new Date().toISOString()
      );
      console.debug('stat: len min 1st mid mean 3rd max sum cnt');
      // console.debug(globalStats);
      // for (const [status, stats] of Object.entries(globalStats)) {
      //   for (const [key, values] of Object.entries(stats)) {
      //     console.debug(
      //       `${status}-${key}: ${values.length} ${summary(values)}`
      //     );
      //   }
      // }
      for (const [key, stats] of Object.entries(callStats)) {
        console.debug(`${key}: ${inspect(stats)}`);
      }
      for (const [key, values] of Object.entries(stepStats)) {
        if (values.length) console.debug(`${key}: ${summary(values)}`);
      }
    };

    const splitArea = (area: Area): Area[] => {
      let area1, area2: Area;
      const {sizeX, sizeY, posX: x, posY: y} = area;
      if (sizeY > sizeX) {
        const midSizeY = Math.floor(sizeY / 2);
        area1 = {
          posX: x,
          posY: y,
          sizeX,
          sizeY: midSizeY,
        };
        area2 = {
          posX: x,
          posY: y + midSizeY,
          sizeX,
          sizeY: sizeY - midSizeY,
        };
      } else {
        const midSizeX = Math.floor(sizeX / 2);
        area1 = {
          posX: x,
          posY: y,
          sizeX: midSizeX,
          sizeY,
        };
        area2 = {
          posX: x + midSizeX,
          posY: y,
          sizeX: sizeX - midSizeX,
          sizeY,
        };
      }

      return [area1, area2];
    };

    const findAreaWithTreasures = async (
      initArea: Area
    ): Promise<Explore | null> => {
      let area = initArea;
      let explore: Explore | null = await post_explore(area);
      if (!explore) return null;
      if (!explore.amount) return null;
      while (area.sizeX > 1 || area.sizeY > 1) {
        const areas = splitArea(area);

        try {
          explore = await post_explore(areas[0]);
        } catch (error) {
          if (error instanceof Error) {
            console.debug(
              'area: %o; area0: %o; area1: %o; error: %o',
              area,
              areas[0],
              areas[1],
              error.message
            );
          } else {
            console.debug(
              'area: %o; area0: %o; area1: %o; error: %o',
              area,
              areas[0],
              areas[1],
              error
            );
          }
        }

        if (explore && explore.amount) {
          area = explore.area;
        } else {
          area = areas[1];
        }
      }

      if (explore) return explore;
      return await post_explore(area);
    };

    const defaultReqErrorHandler = (error: Error) => {
      if ('code' in error) {
        if (
          !['ECONNRESET', 'ECONNREFUSED'].includes(
            (error as {code: string}).code
          )
        ) {
          console.log('defaultReqErrorHandler', error);
        }
      }
    };
    const post_explore = async function (area: Area): Promise<Explore | null> {
      return new Promise(resolve => {
        const data = JSON.stringify(area);

        const timings = {
          startAt: performance.now(),
          dnsLookupAt: 0,
          tcpConnectionAt: 0,
          firstByteAt: 0,
          endAt: 0,
        };

        const options: RequestOptions = {
          hostname: process.env.ADDRESS,
          port: 8000,
          path: '/explore',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
        };

        const chunks: Buffer[] = [];
        const req = request(options, res => {
          res.once('readable', () => {
            timings.firstByteAt = performance.now();
          });
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            timings.endAt = performance.now();
            const status = res.statusCode || -1;
            if (status === 200) {
              resolve(JSON.parse(Buffer.concat(chunks).toString()) as Explore);
            } else {
              resolve(null);
            }
            callStats.explore.setTime(
              status,
              performance.now() - timings.startAt
            );
            const stats = globalStats[status];
            if (stats) {
              stats.dnsLookup.push(timings.dnsLookupAt - timings.startAt);
              stats.tcpConnection.push(
                (timings.dnsLookupAt || timings.tcpConnectionAt) -
                  timings.startAt
              );
              stats.firstByte.push(
                timings.firstByteAt - timings.tcpConnectionAt
              );
              stats.contentTransfer.push(timings.endAt - timings.firstByteAt);
              stats.total.push(timings.endAt - timings.startAt);
            } else {
              globalStats[status] = {
                dnsLookup: [timings.dnsLookupAt - timings.startAt],
                tcpConnection: [
                  (timings.dnsLookupAt || timings.tcpConnectionAt) -
                    timings.startAt,
                ],
                firstByte: [timings.firstByteAt - timings.tcpConnectionAt],
                contentTransfer: [timings.endAt - timings.firstByteAt],
                total: [timings.endAt - timings.startAt],
              };
            }
          });
        });
        req.on('error', defaultReqErrorHandler);

        req.on('socket', socket => {
          socket.on('lookup', () => {
            timings.dnsLookupAt = performance.now();
          });
          socket.on('connect', () => {
            timings.tcpConnectionAt = performance.now();
          });
        });

        req.write(data);
        req.end();
      });
    };

    const wallet: number[] = [];
    let license: License | null = null;
    const update_license = async function (): Promise<void> {
      return new Promise(resolve => {
        let coins: number[] = [];
        if (wallet.length) {
          if (wallet.length > 21) {
            coins = wallet.splice(0, 21);
          } else if (wallet.length > 11) {
            coins = wallet.splice(0, 11);
          } else if (wallet.length > 6) {
            coins = wallet.splice(0, 6);
          } else {
            const coin = wallet.pop();
            if (coin) coins = [coin];
          }
        }

        const data = JSON.stringify(coins);

        const timings = {
          startAt: performance.now(),
          dnsLookupAt: 0,
          tcpConnectionAt: 0,
          firstByteAt: 0,
          endAt: 0,
        };

        const options: RequestOptions = {
          hostname: process.env.ADDRESS,
          port: 8000,
          path: '/licenses',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
        };

        const chunks: Buffer[] = [];
        const req = request(options, res => {
          // res.once('readable', () => {
          //   timings.firstByteAt = performance.now();
          // });
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            // timings.endAt = performance.now();
            const status = res.statusCode || -1;
            if (status === 200) {
              license = JSON.parse(Buffer.concat(chunks).toString()) as License;
            }
            if (coins.length) {
              callStats.licensePaid.setTime(
                status,
                performance.now() - timings.startAt
              );
            } else {
              callStats.licenseFree.setTime(
                status,
                performance.now() - timings.startAt
              );
            }
            resolve();
            // const stats = globalStats[status];
            // if (stats) {
            //   stats.dnsLookup.push(timings.dnsLookupAt - timings.startAt);
            //   stats.tcpConnection.push(
            //     (timings.dnsLookupAt || timings.tcpConnectionAt) - timings.startAt
            //   );
            //   stats.firstByte.push(timings.firstByteAt - timings.tcpConnectionAt);
            //   stats.contentTransfer.push(timings.endAt - timings.firstByteAt);
            //   stats.total.push(timings.endAt - timings.startAt);
            // } else {
            //   globalStats[status] = {
            //     dnsLookup: [timings.dnsLookupAt - timings.startAt],
            //     tcpConnection: [
            //       (timings.dnsLookupAt || timings.tcpConnectionAt) -
            //         timings.startAt,
            //     ],
            //     firstByte: [timings.firstByteAt - timings.tcpConnectionAt],
            //     contentTransfer: [timings.endAt - timings.firstByteAt],
            //     total: [timings.endAt - timings.startAt],
            //   };
            // }
          });
        });
        // req.on('socket', socket => {
        //   socket.on('lookup', () => {
        //     timings.dnsLookupAt = performance.now();
        //   });
        //   socket.on('connect', () => {
        //     timings.tcpConnectionAt = performance.now();
        //   });
        // });
        req.on('error', defaultReqErrorHandler);

        req.write(data);
        req.end();
      });
    };

    type Dig = {
      licenseID: number;
      posX: number;
      posY: number;
      depth: number;
    };

    const post_dig = async function (dig: Dig): Promise<string[] | null> {
      return new Promise(resolve => {
        const data = JSON.stringify(dig);

        const timings = {
          startAt: performance.now(),
          dnsLookupAt: 0,
          tcpConnectionAt: 0,
          firstByteAt: 0,
          endAt: 0,
        };

        const options: RequestOptions = {
          hostname: process.env.ADDRESS,
          port: 8000,
          path: '/dig',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
        };

        const chunks: Buffer[] = [];
        const req = request(options, res => {
          // res.once('readable', () => {
          //   timings.firstByteAt = performance.now();
          // });
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            // timings.endAt = performance.now();
            const status = res.statusCode || -1;
            if (status === 200) {
              resolve(JSON.parse(Buffer.concat(chunks).toString()) as string[]);
            }
            // else {
            //   console.debug(JSON.parse(Buffer.concat(chunks).toString()));
            // }
            callStats.dig.setTime(status, performance.now() - timings.startAt);
            resolve(null);
            // const stats = globalStats[status];
            // if (stats) {
            //   stats.dnsLookup.push(timings.dnsLookupAt - timings.startAt);
            //   stats.tcpConnection.push(
            //     (timings.dnsLookupAt || timings.tcpConnectionAt) - timings.startAt
            //   );
            //   stats.firstByte.push(timings.firstByteAt - timings.tcpConnectionAt);
            //   stats.contentTransfer.push(timings.endAt - timings.firstByteAt);
            //   stats.total.push(timings.endAt - timings.startAt);
            // } else {
            //   globalStats[status] = {
            //     dnsLookup: [timings.dnsLookupAt - timings.startAt],
            //     tcpConnection: [
            //       (timings.dnsLookupAt || timings.tcpConnectionAt) -
            //         timings.startAt,
            //     ],
            //     firstByte: [timings.firstByteAt - timings.tcpConnectionAt],
            //     contentTransfer: [timings.endAt - timings.firstByteAt],
            //     total: [timings.endAt - timings.startAt],
            //   };
            // }
          });
        });
        // req.on('socket', socket => {
        //   socket.on('lookup', () => {
        //     timings.dnsLookupAt = performance.now();
        //   });
        //   socket.on('connect', () => {
        //     timings.tcpConnectionAt = performance.now();
        //   });
        // });
        req.on('error', defaultReqErrorHandler);

        req.write(data);
        req.end();
      });
    };

    const post_cash = async function (treasure: string): Promise<void> {
      return new Promise(resolve => {
        const data = JSON.stringify(treasure);

        const timings = {
          startAt: performance.now(),
          dnsLookupAt: 0,
          tcpConnectionAt: 0,
          firstByteAt: 0,
          endAt: 0,
        };

        const options: RequestOptions = {
          hostname: process.env.ADDRESS,
          port: 8000,
          path: '/cash',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length,
          },
        };

        const chunks: Buffer[] = [];
        const req = request(options, res => {
          // res.once('readable', () => {
          //   timings.firstByteAt = performance.now();
          // });
          res.on('error', defaultReqErrorHandler);
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on('end', () => {
            // timings.endAt = performance.now();
            const status = res.statusCode || -1;
            if (status === 200) {
              for (const coin of JSON.parse(
                Buffer.concat(chunks).toString()
              ) as number[]) {
                wallet.push(coin);
              }
            }
            // else {
            //   console.debug(Buffer.concat(chunks).toString())
            // }
            callStats.cash.setTime(status, performance.now() - timings.startAt);
            resolve();
            // const stats = globalStats[status];
            // if (stats) {
            //   stats.dnsLookup.push(timings.dnsLookupAt - timings.startAt);
            //   stats.tcpConnection.push(
            //     (timings.dnsLookupAt || timings.tcpConnectionAt) - timings.startAt
            //   );
            //   stats.firstByte.push(timings.firstByteAt - timings.tcpConnectionAt);
            //   stats.contentTransfer.push(timings.endAt - timings.firstByteAt);
            //   stats.total.push(timings.endAt - timings.startAt);
            // } else {
            //   globalStats[status] = {
            //     dnsLookup: [timings.dnsLookupAt - timings.startAt],
            //     tcpConnection: [
            //       (timings.dnsLookupAt || timings.tcpConnectionAt) -
            //         timings.startAt,
            //     ],
            //     firstByte: [timings.firstByteAt - timings.tcpConnectionAt],
            //     contentTransfer: [timings.endAt - timings.firstByteAt],
            //     total: [timings.endAt - timings.startAt],
            //   };
            // }
          });
        });
        // req.on('socket', socket => {
        //   socket.on('lookup', () => {
        //     timings.dnsLookupAt = performance.now();
        //   });
        //   socket.on('connect', () => {
        //     timings.tcpConnectionAt = performance.now();
        //   });
        // });
        req.on('error', defaultReqErrorHandler);

        req.write(data);
        req.end();
      });
    };

    const start = async () => {
      const statsInterval = setInterval(() => writeStats(), PRINT_STATS_TIME);
      statsInterval.unref();

      let minX = 0;
      let minY = 0;
      let maxX = 0;
      let maxY = 0;
      const xParts = 2;
      const yParts = 2;
      const xPartSize = 3500 / xParts;
      const yPartSize = 3500 / yParts;

      minX = Math.round((instanceId % xParts) * xPartSize);
      minY = Math.round(((instanceId / xParts) | 0) * yPartSize);

      maxX = minX + xPartSize;
      maxY = minY + yPartSize;

      console.debug('msg', msg, minX, maxX, minY, maxY);
      // await sleep(instanceId * 50)

      // const minX = 0
      // const maxX = 3500
      // const minY = 0
      // const maxY = 3500

      for (
        let globalX = minX + GLOBAL_OFFSET_X;
        globalX + EXPLORE_SIZE < maxX;
        globalX += EXPLORE_SIZE
      ) {
        for (
          let globalY = minY + GLOBAL_OFFSET_Y;
          globalY + EXPLORE_SIZE < maxY;
          globalY += EXPLORE_SIZE
        ) {
          const area: Area = {
            posX: globalX,
            posY: globalY,
            sizeX: EXPLORE_SIZE,
            sizeY: EXPLORE_SIZE,
          };
          areas.push(area);
        }
      }

      try {
        while (areas.length) {
          while (
            areas.length &&
            (!license ||
              license.digUsed >= license.digAllowed ||
              !explores.length)
          ) {
            const start = performance.now();
            let licensePromise: Promise<void> | null = null;
            if (!license || license.digUsed >= license.digAllowed)
              licensePromise = update_license();
            const area = areas.pop();
            if (area) {
              const explore = await findAreaWithTreasures(area);
              exploreStats.tries++;
              if (explore && explore.amount) {
                explores.push(explore);
                exploreStats.amount++;
              }
              if (explore) stepStats.exploreAmount.push(explore.amount);
              stepStats.explore.push(performance.now() - start);
            }
            if (licensePromise) await licensePromise;
            stepStats.licenseAndExplore.push(performance.now() - start);
          }

          const result = explores.pop();
          if (result) {
            const start = performance.now();
            let left = result.amount;
            let depth = 1;
            while (left && depth < 10) {
              while (!license || license.digUsed >= license.digAllowed) {
                const s = performance.now();
                await update_license();
                stepStats.refreshLicense.push(performance.now() - s);
              }
              const dig: Dig = {
                depth,
                posX: result.area.posX,
                posY: result.area.posY,
                licenseID: license.id,
              };
              const treasures = await post_dig(dig);
              if (treasures) {
                left--;
                for (const treasure of treasures) {
                  pqCash.add(
                    async () => {
                      await post_cash(treasure);
                    },
                    {priority: 1}
                  );
                }
              }
              license.digUsed++;
              depth++;
            }
            stepStats.digging.push(performance.now() - start);
          }
        }
      } catch (error: unknown) {
        console.error('ERROR', error);
        writeStats();
        await sleep(1000);
      }
    };

    start();
  });
}

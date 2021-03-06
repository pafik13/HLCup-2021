type License = {
  id: number;
  digAllowed: number;
  digUsed: number;
};

type Area = {
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
};

type Dig = {
  licenseID: number;
  posX: number;
  posY: number;
  depth: number;
};

type Explore = {
  priority?: number;
  area: Area;
  amount: number;
};

type Wallet = {
  balance: number;
  wallet: number[];
};

type Treasure = {
  priority: number;
  treasures: string[];
};

const noop = () => {};

process.on('unhandledRejection', () => {
  async () => await writeStats(apiClient);
});

process.on('uncaughtException', () => {
  async () => await writeStats(apiClient);
});

import {performance} from 'perf_hooks';
import {inspect} from 'util';

// import {addLogger} from 'axios-debug-log';
import axios, {AxiosInstance, AxiosRequestConfig} from 'axios';
const rateLimit = require('axios-rate-limit');
import debug, {Debugger} from 'debug';
import {asyncWorker, promise as fastQPromise} from 'fastq';
import PQueue from 'p-queue';

const MAX_PDIG_SIZE = Number(process.env.MAX_PDIG_SIZE) || 10;
const STEP = Number(process.env.STEP) || 125;
const SQ_SIZE = STEP * STEP;
console.debug(
  'start ' + process.env.INSTANCE_ID,
  'MAX_PDIG_SIZE',
  MAX_PDIG_SIZE,
  'STEP',
  STEP,
  'SQ_SIZE',
  SQ_SIZE
);

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);

const baseClient = axios.create({
  baseURL,
  validateStatus: () => true /*, timeout: 10*/,
});
const client = rateLimit(baseClient, {
  maxRequests: 140,
  perMilliseconds: 1000,
  maxRPS: 140,
});

// client.interceptors.response.use(function (response) {
//   // Any status code that lie within the range of 2xx cause this function to trigger
//   // Do something with response data
//   return response;
// }, function (error) {
//   // Any status codes that falls outside the range of 2xx cause this function to trigger
//   // Do something with response error
//   return Promise.resolve() //Promise.reject(error);
// });

const logger = debug('instance');
const log = logger.extend(String(process.env.INSTANCE_ID));

// const metricsInterval = setInterval(async () => {
//   logger(await promClient.register.metrics());
// }, 30000);
// metricsInterval.unref();

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const writeStats = async (client: APIClient) => {
  let total = 0,
    errors = 0;
  for (const stat of Object.values(client.stats)) {
    total += stat.success;
    for (const value of Object.values(stat.error)) {
      total += value;
      errors += value;
    }
  }
  const periodInSeconds = ((performance.now() - client.start) / 1000) | 0;
  const rps = total / periodInSeconds;
  log(
    'client pqExploreSize: %d, qDigLen: %d, digTasksSize: %d, pqCashSize: %d, total %d; errors: %d, rps: %d; client stats: %o',
    pqExplore.size,
    qDig.length(),
    client.digTasksSize(),
    pqCash.size,
    total,
    errors,
    rps,
    client.stats
  );
};

class CallStats {
  public success = 0;
  public error: Record<number, number> = {};
  public time: Record<number, number> = {};

  setTime = (status: number, time: number): void => {
    if (this.time[status]) {
      this.time[status] += time;
    } else {
      this.time[status] = time;
    }
  };

  [inspect.custom]() {
    return `[${this.success}; ${inspect(this.error)}; ${inspect(this.time)}]`;
  }
}

// CallStats.prototype.toString = function callStatsToString() {
//   return `[${this.success}; ${inspect(this.error)}; ${this.time}]`;
// };

class DigStats {
  public depth: Record<number, number> = {};
  public amount: Record<number, number> = {};
  public treasuresByDepth: Record<number, number[]> = {};
  public treasuresByAmount: Record<number, number[]> = {};

  public cashByDepth: Record<number, number[]> = {};
  public cashByAmount: Record<number, number[]> = {};

  constructor() {
    for (let i = 0; i <= 10; i++) {
      this.treasuresByDepth[i] = [];
      this.treasuresByAmount[i] = [];
      this.cashByDepth[i] = [];
      this.cashByAmount[i] = [];

      this.amount[i] = 0;
      this.depth[i] = 0;
    }
  }
}

const pqExplore = new PQueue({concurrency: 3});
const pqCash = new PQueue({concurrency: 10});

const digSuccess = [200, 404];

class APIClient {
  public stats = {
    dig: new CallStats(),
    cash: new CallStats(),
    licenseFree: new CallStats(),
    licensePaid: new CallStats(),
    // licenseList: new CallStats(),
    explore: new CallStats(),
  };

  public digStats = new DigStats();

  public digTasks = Array.from(Array(10).keys()).reduce(
    (acc: Record<number, Dig[]>, cur) => {
      acc[cur + 1] = [];
      return acc;
    },
    {}
  );

  digTasksSize() {
    let result = 0;
    for (let i = 1; i <= 10; i++) {
      result += this.digTasks[i].length;
    }
    return result;
  }

  public wallet: Wallet = {
    balance: 0,
    wallet: [],
  };

  private axiosConfigForCash: AxiosRequestConfig = {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
    },
  };
  public client: AxiosInstance;
  public license?: License;
  readonly start: number;
  constructor(client: AxiosInstance) {
    this.client = client;
    this.start = performance.now();
  }

  async post_license(coins: number[]): Promise<License | null> {
    try {
      const start = performance.now();
      const result = await this.client.post<License>('/licenses', coins);
      const isSuccess = result.status === 200;
      if (isSuccess) {
        if (coins.length) {
          this.stats.licensePaid.success++;
          this.stats.licensePaid.setTime(
            result.status,
            performance.now() - start
          );
        } else {
          this.stats.licenseFree.success++;
          this.stats.licenseFree.setTime(
            result.status,
            performance.now() - start
          );
        }
        return result.data;
      }
      if (coins.length) {
        this.stats.licensePaid.setTime(
          result.status,
          performance.now() - start
        );

        this.stats.licensePaid.error[result.status] =
          ++this.stats.licensePaid.error[result.status] || 1;
      } else {
        this.stats.licenseFree.setTime(
          result.status,
          performance.now() - start
        );

        this.stats.licenseFree.error[result.status] =
          ++this.stats.licenseFree.error[result.status] || 1;
      }
    } catch (error) {
      await writeStats(this);
    }
    return null;
  }

  // async get_license(): Promise<License[] | null> {
  //   const start = performance.now();
  //   const result = await this.client.get<License[]>('/licenses');
  //   const isSuccess = result.status === 200;
  //   this.stats.licenseList.setTime(result.status, performance.now() - start);
  //   if (isSuccess) {
  //     this.stats.licenseList.success++;
  //     return result.data;
  //   }
  //   this.stats.licenseList.error[result.status] =
  //     ++this.stats.licenseList.error[result.status] || 1;
  //   return null;
  // }

  async post_dig(dig: Dig): Promise<Treasure | null> {
    try {
      const start = performance.now();
      const result = await this.client.post<string[]>('/dig', dig);
      if (
        digSuccess.includes(result.status) &&
        dig.licenseID === this.license?.id
      ) {
        this.license.digUsed++;
      }
      const isSuccess = result.status === 200;
      this.stats.dig.setTime(result.status, performance.now() - start);
      if (isSuccess) {
        this.stats.dig.success++;
        return {priority: 0, treasures: result.data};
      }
      this.stats.dig.error[result.status] =
        ++this.stats.dig.error[result.status] || 1;
      if (result.status === 403) {
        log('dig 403: %o resut: %o', dig, result.data);
        if (this.license) delete this.license;
      }
      if (result.status === 422) log('dig 422: %o resut: %o', dig, result.data);
      if (dig.depth < 10) {
        dig.depth++;
        this.digTasks[dig.depth].push(dig);
      }
    } catch (error) {
      await writeStats(this);
    }
    return null;
  }

  async post_cash(treasure: string): Promise<number[] | null> {
    try {
      const start = performance.now();
      const result = await this.client.post<number[]>(
        '/cash',
        JSON.stringify(treasure),
        this.axiosConfigForCash
      );
      const isSuccess = result.status === 200;
      this.stats.cash.setTime(result.status, performance.now() - start);
      if (isSuccess) {
        this.stats.cash.success++;
        this.wallet.balance += result.data.length;
        for (const coin of result.data) {
          this.wallet.wallet.push(coin);
        }
        return result.data;
      }
      pqCash.add(
        async () => {
          await this.post_cash(treasure);
        },
        {priority: 1}
      );
      this.stats.cash.error[result.status] =
        ++this.stats.cash.error[result.status] || 1;
    } catch (error) {
      await writeStats(this);
    }
    return null;
  }

  async post_explore(area: Area): Promise<Explore | null> {
    try {
      const start = performance.now();
      const result = await this.client.post<Explore>('/explore', area);
      const isSuccess = result.status === 200;
      this.stats.explore.setTime(result.status, performance.now() - start);
      if (isSuccess) {
        this.stats.explore.success++;
        result.data.priority = 0;
        return result.data;
      }
      this.stats.explore.error[result.status] =
        ++this.stats.explore.error[result.status] || 1;
      if (result.status === 422) {
        throw Error('422');
      }
    } catch (error) {
      await writeStats(this);
    }
    return null;
  }

  // async get_balance(): Promise<Wallet | null> {
  //   const end = apiMetrics.startTimer();
  //   const result = await this.client.get<Wallet>('balance');
  //   const isSuccess = result.status === 200;
  //   end({
  //     method: result.config.method,
  //     route: result.config.url,
  //     status: result.status,
  //     response_size: isSuccess ? 1 : 0,
  //   });
  //   if (isSuccess) return result.data;
  //   return null;
  // }

  async update_license(coins: number[] = []): Promise<number> {
    try {
      const start = performance.now();
      if (this.wallet.wallet.length) {
        if (this.wallet.wallet.length > 21) {
          coins = this.wallet.wallet.splice(0, 21);
        } else if (this.wallet.wallet.length > 11) {
          coins = this.wallet.wallet.splice(0, 11);
        } else if (this.wallet.wallet.length > 6) {
          coins = this.wallet.wallet.splice(0, 6);
        } else {
          const coin = this.wallet.wallet.pop();
          if (coin) coins.push(coin);
        }
      }
      const license = await this.post_license(coins);
      if (license) this.license = license;
      const time = performance.now() - start;
      return time;
      // log('coins: %o; time: %d; license: %o', coins.length, time, license);
    } catch (error) {
      await writeStats(this);
    }
    return 0;
  }
}

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
  logger: Debugger,
  client: APIClient,
  initArea: Area
): Promise<{area: Area; explore: Explore | null}> => {
  let area = initArea;
  let explore = null;
  while (area.sizeX > 1 || area.sizeY > 1) {
    try {
      const areas = splitArea(area);

      let explores: Array<Explore | null> = [null, null];
      try {
        explores = await Promise.all(areas.map(it => client.post_explore(it)));
      } catch (error) {
        if (error instanceof Error) {
          logger(
            'area: %o; area0: %o; area1: %o; error: %o',
            area,
            areas[0],
            areas[1],
            error.message
          );
        } else {
          logger(
            'area: %o; area0: %o; area1: %o; error: %o',
            area,
            areas[0],
            areas[1],
            error
          );
        }
      }

      const explore0 = explores[0];
      const explore1 = explores[1];

      if (explore0 && explore1) {
        if (explore0.amount > explore1.amount) {
          area = explore0.area;
          explore = explore0;
          if (explore1.amount)
            pqExplore.add(async () => exploreWorker(client, explore1), {
              priority: SQ_SIZE - explore1.area.sizeX * explore1.area.sizeY,
            });
        } else {
          area = explore1.area;
          explore = explore1;
          if (explore0.amount)
            pqExplore.add(async () => exploreWorker(client, explore0), {
              priority: SQ_SIZE - explore0.area.sizeX * explore0.area.sizeY,
            });
        }
      } else if (!explore0 && !explore1) {
        area = areas[0];
        explore = null;
      } else {
        if (explore1) {
          area = explore1.area;
          explore = explore1;
        }
        if (explore0) {
          area = explore0.area;
          explore = explore0;
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger('findAreaWithTreasures error: %s', error.message);
      } else {
        logger('findAreaWithTreasures error: %o', error);
      }
      logger('findAreaWithTreasures error area: %o', area);
    }
  }
  return {area, explore};
};

const exploreWorker = async function (client: APIClient, explore: Explore) {
  const {explore: exploreWithTreasures} = await findAreaWithTreasures(
    log,
    client,
    explore.area
  );
  if (exploreWithTreasures && exploreWithTreasures.amount) {
    qDig.push(exploreWithTreasures);
  }
};

const apiClient = new APIClient(client);

const digWorker: asyncWorker<QContext, Explore, void> = async function (
  explore: Explore
) {
  const {client} = this;
  if (
    qDig.length() > MAX_PDIG_SIZE ||
    client.digTasksSize() > Math.pow(MAX_PDIG_SIZE, 2)
  ) {
    pqExplore.pause();
  } else if (pqExplore.isPaused) {
    pqExplore.start();
  }
  const dig = {
    licenseID: -1,
    posX: explore.area.posX,
    posY: explore.area.posY,
    depth: 1,
  };
  client.digTasks[1].push(dig);
  // log('client.digTasks before: %o', client.digTasks);
  // log('client.license before: %o', client.license);
  while (
    !client.license ||
    client.license.digUsed >= client.license.digAllowed
  ) {
    await client.update_license();
  }
  // log('client.license updated: %o', client.license);
  const {digAllowed, digUsed} = client.license;
  const taskLimit = digAllowed - digUsed;
  const tasks = [];
  for (let i = 10; i > 0 && tasks.length < taskLimit; i--) {
    const digTasks = client.digTasks[i];
    if (digTasks.length) {
      do {
        const dig = digTasks.pop();
        if (dig) {
          dig.licenseID = client.license.id;
          tasks.push(client.post_dig(dig));
        }
        // log('iter: i: %d dig: %d tasks: %d limit: %d', i, digTasks.length, tasks.length, taskLimit);
      } while (digTasks.length && tasks.length < taskLimit);
    }
  }
  const results = await Promise.all(tasks);
  // log('client.license after: %o', client.license);
  // log('client.digTasks after: %o', client.digTasks);
  // await sleep(1000);
  for (const result of results) {
    if (result) {
      for (const treasure of result.treasures) {
        pqCash.add(
          async () => {
            await client.post_cash(treasure);
          },
          {priority: 1}
        );
      }
    }
  }
};

type QContext = {client: APIClient; log: Debugger};

const qDig = fastQPromise<{client: APIClient; log: Debugger}, Explore, void>(
  {client: apiClient, log},
  digWorker,
  1
);

const game = async (client: APIClient) => {
  const statsInterval = setInterval(
    async () => await writeStats(client),
    30000
  );
  statsInterval.unref();

  const instanceId = Number(process.env.INSTANCE_ID);

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

  const wholeArea: Area = {
    posX: minX,
    posY: minY,
    sizeX: xPartSize,
    sizeY: yPartSize,
  };

  log('wholeArea: %o', wholeArea);
  const wholeExplore: Explore = {area: wholeArea, amount: 10}; //await client.post_explore(wholeArea);
  if (!wholeExplore) {
    log('wholeExplore is empty');
  } else {
    // log('wholeExplore: %o', wholeExplore);

    // ???????????????? ?????????? 1 750: 1, 2, 5, 7, 10, 14, 25, 35, 50, 70,  125,  175,  250,  350,  875, 1 750
    // ???????????????????? ??????????????????: 16
    for (let globalX = minX; globalX < maxX; globalX += STEP) {
      for (let globalY = minY; globalY < maxY; globalY += STEP) {
        const area: Area = {
          posX: globalX,
          posY: globalY,
          sizeX: STEP,
          sizeY: STEP,
        };
        try {
          const explore = await client.post_explore(area);
          if (explore && explore.amount) {
            pqExplore.add(async () => await exploreWorker(client, explore), {
              priority: 1,
            });
          }
        } catch (error: unknown) {
          await writeStats(client);
          await sleep(1000);
        }
      }
    }
  }

  log('End. client stats: %o', client.stats);
};

game(apiClient);

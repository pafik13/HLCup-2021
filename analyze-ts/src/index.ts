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

type License = {
  id: number;
  digAllowed: number;
  digUsed: number;
};

type Dig = {
  licenseID: number;
  posX: number;
  posY: number;
  depth: number;
};

type Wallet = {
  balance: number;
  wallet: number[];
};

type Treasure = {
  dig: Dig;
  treasures: string[];
};

process.on('unhandledRejection', () => {
  async () => await writeStats(apiClient);
});

process.on('uncaughtException', () => {
  async () => await writeStats(apiClient);
});

import {performance} from 'perf_hooks';
import {inspect} from 'util';

import * as request from 'superagent';
import * as saprefix from 'superagent-prefix';

import debug from 'debug';
import PQueue from 'p-queue';

const MAX_LICENSE_COUNT = 2;
const GLOBAL_OFFSET_X = Number(process.env.GLOBAL_OFFSET_X) || 0;
const GLOBAL_OFFSET_Y = Number(process.env.GLOBAL_OFFSET_Y) || 0;
const EXPLORE_CONCURRENCY = Number(process.env.EXPLORE_CONCURRENCY) || 50;
const PQCASH_CONCURRENCY = Number(process.env.PQCASH_CONCURRENCY) || 40;
console.debug(
  'start ' + process.env.INSTANCE_ID,
  'GLOBAL_OFFSET_X',
  GLOBAL_OFFSET_X,
  'GLOBAL_OFFSET_Y',
  GLOBAL_OFFSET_Y,
  'MAX_LICENSE_COUNT',
  MAX_LICENSE_COUNT,
  'EXPLORE_CONCURRENCY',
  EXPLORE_CONCURRENCY,
  'PQCASH_CONCURRENCY',
  PQCASH_CONCURRENCY
);

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);
const prefix = saprefix(baseURL);
const client = request;

const logger = debug('instance');
const log = logger.extend(String(process.env.INSTANCE_ID));
const digCache: number[][] = require(`./dig${process.env.INSTANCE_ID}.json`);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const pqCash = new PQueue({concurrency: PQCASH_CONCURRENCY});

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
    'client total %d; errors: %d, rps: %d; client stats: %o; exploreTries: %d; exploreResults:%d; digTasksSize: %d, get_digAllowed: %d; needDig: %s; pqCashSize: %d',
    total,
    errors,
    rps,
    client.stats,
    client.exploreTries,
    client.exploreResults.reduce((a, b) => a + b, 0),
    client.digTasksSize(),
    client.get_digAllowed(),
    client.digTasksSize() > client.get_digAllowed(),
    pqCash.size
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

const digSuccess = [200, 404];

class APIClient {
  public stats = {
    explore: new CallStats(),
    licenseFree: new CallStats(),
    licensePaid: new CallStats(),
    dig: new CallStats(),
    cash: new CallStats(),
  };
  public exploreTries = 0;
  public exploreResults: number[] = [];

  public treasuresSizes: number[] = [];
  public treasuresDepths = [];

  public wallet: Wallet = {
    balance: 0,
    wallet: [],
  };

  licenses: number[] = [];

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

  public treasuresStats: number[][] = [];

  public client: request.SuperAgentStatic;
  readonly start: number;
  constructor(client: request.SuperAgentStatic) {
    this.client = client;
    this.start = performance.now();
  }

  async post_explore(area: Area): Promise<Explore | null> {
    try {
      const start = performance.now();
      const result = await this.client
        .post('/explore')
        .use(prefix)
        .ok(res => true)
        .send(area);
      const isSuccess = result.status === 200;
      this.stats.explore.setTime(result.status, performance.now() - start);
      if (isSuccess) {
        this.stats.explore.success++;
        result.body.priority = 0;
        return result.body;
      }
      this.stats.explore.error[result.status] =
        ++this.stats.explore.error[result.status] || 1;
      if (result.status === 422) {
        throw Error('422');
      }
    } catch (error) {
      log(error);
      await writeStats(this);
    }
    return null;
  }

  async post_license(coins: number[]): Promise<License | null> {
    try {
      const start = performance.now();
      const result = await this.client
        .post('/licenses')
        .use(prefix)
        .ok(res => true)
        .send(coins);
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
        return result.body;
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
      log(error);
      await writeStats(this);
    }
    return null;
  }

  get_digAllowed() {
    return this.licenses.length;
  }

  async update_license(coins: number[] = []): Promise<number> {
    try {
      // log('licenses before: %o', this.licenses);
      const start = performance.now();
      const unique = [...new Set(this.licenses)];
      if (unique.length < MAX_LICENSE_COUNT) {
        const tasks: Promise<License | null>[] = [];
        for (let i = 0; i < MAX_LICENSE_COUNT - unique.length; i++) {
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
          tasks.push(this.post_license(coins));
        }
        const results = await Promise.all(tasks);
        for (const result of results) {
          if (result)
            this.licenses.push(...Array(result.digAllowed).fill(result.id));
        }
      }
      const time = performance.now() - start;
      // log('licenses after: %o, time: %d;', this.licenses, time);
      return time;
    } catch (error) {
      log(error);
      await writeStats(this);
    }
    return 0;
  }

  async post_dig(dig: Dig): Promise<Treasure | null> {
    try {
      const start = performance.now();
      const result = await this.client
        .post('/dig')
        .use(prefix)
        .ok(res => true)
        .send(dig);
      const isSuccess = result.status === 200;
      this.stats.dig.setTime(result.status, performance.now() - start);
      if (isSuccess) {
        this.stats.dig.success++;
        return {dig, treasures: result.body};
      }
      this.stats.dig.error[result.status] =
        ++this.stats.dig.error[result.status] || 1;
      if (result.status === 403) {
        log('dig 403: %o resut: %o', dig, result.body);
        dig.licenseID = -1;
        this.digTasks[dig.depth].push(dig);
      }
      if (result.status === 422) log('dig 422: %o resut: %o', dig, result.body);
      if (result.status === 404 && dig.depth < 10) {
        dig.licenseID = -1;
        dig.depth++;
        this.digTasks[dig.depth].push(dig);
      }
    } catch (error) {
      log(error);
      await writeStats(this);
    }
    return null;
  }

  async post_cash(dig: Dig, treasure: string): Promise<number[] | null> {
    try {
      const start = performance.now();
      const result = await this.client
        .post('/cash')
        .use(prefix)
        .ok(res => true)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(treasure));
      const isSuccess = result.status === 200;
      this.stats.cash.setTime(result.status, performance.now() - start);
      if (isSuccess) {
        this.stats.cash.success++;
        this.wallet.balance += result.body.length;
        for (const coin of result.body) {
          this.wallet.wallet.push(coin);
        }
        // this.treasuresStats.push([
        //   dig.posX,
        //   dig.posY,
        //   dig.depth,
        //   result.data.length,
        // ]);
        // if (this.treasuresStats.length === 30) {
        //   log('treasuresStats: %o', this.treasuresStats);
        //   this.treasuresStats = [];
        // }
        return result.body;
      }
      pqCash.add(
        async () => {
          await this.post_cash(dig, treasure);
        },
        {priority: dig.depth}
      );
      this.stats.cash.error[result.status] =
        ++this.stats.cash.error[result.status] || 1;
    } catch (error) {
      log(error);
      await writeStats(this);
    }
    return null;
  }
}

const digWorker = async function (client: APIClient) {
  // log('digWorker license before: %o', client.licenses);
  // log('digWorker digTasks before: %o', client.digTasks);

  const tasks = [];
  for (let i = 10; i > 0 && client.licenses.length; i--) {
    const digTasks = client.digTasks[i];
    if (digTasks.length) {
      do {
        const dig = digTasks.pop();
        const licenseID = client.licenses.pop();
        if (dig && typeof licenseID !== 'undefined') {
          dig.licenseID = licenseID;
          tasks.push(client.post_dig(dig));
        }
      } while (digTasks.length && client.licenses.length);
    }
  }

  // log('digWorker license after: %o', client.licenses);
  // log('digWorker digTasks after: %o', client.digTasks);

  const results = await Promise.all(tasks);
  for (const result of results) {
    if (result) {
      for (const treasure of result.treasures) {
        pqCash.add(
          async () => {
            await client.post_cash(result.dig, treasure);
          },
          {priority: result.dig.depth}
        );
      }
    }
  }
  // log('tasks resuls: %o', results);
};

const apiClient = new APIClient(client);

const game = async (client: APIClient) => {
  // const statsInterval = setInterval(async () => await writeStats(client), 5000);
  // statsInterval.unref();

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

  const tasks: Promise<Explore | null>[] = [];
  const areas: Area[] = [];
  // const lastDig = digCache.pop();

  // log('minX: %d; minY: %d', minX, minY);
  // log('lastDig: %o', lastDig);
  // if (lastDig) {
  //   minX = minX + GLOBAL_OFFSET_X + lastDig[0];
  //   minY = minY + GLOBAL_OFFSET_Y + lastDig[1];
  //   log('minX: %d; minY: %d', minX, minY);
  // }

  let licensesPromise;
  while (digCache.length) {
    const digs = digCache.splice(0, EXPLORE_CONCURRENCY);
    for (const dig of digs) {
      if (!licensesPromise) licensesPromise = client.update_license();
      const area: Area = {
        posX: dig[0],
        posY: dig[1],
        sizeX: 1,
        sizeY: 1,
      };
      areas.push(area);
      tasks.push(client.post_explore(area));
    }
    try {
      const results = await Promise.all(tasks);
      client.exploreTries++;
      let count = 0;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const area = areas[i];
        if (result && result.amount) {
          count++;
          client.digTasks[1].push({
            licenseID: -1,
            depth: 1,
            posX: area.posX,
            posY: area.posY,
          });
        }
      }
      await licensesPromise;
      client.exploreResults.push(count);
      tasks.length = 0;
      areas.length = 0;
      licensesPromise = null;
      if (client.digTasksSize() > client.get_digAllowed()) {
        await digWorker(client);
      }
    } catch (error: unknown) {
      console.error('ERROR', error);
      await digWorker(client);
      // await writeStats(client);
      // await sleep(1000);
    }
  }

  await digWorker(client);
  tasks.length = 0;
  areas.length = 0;

  for (let globalX = minX + GLOBAL_OFFSET_X; globalX < maxX; globalX += 1) {
    for (let globalY = minY + GLOBAL_OFFSET_Y; globalY < maxY; globalY += 1) {
      const area: Area = {
        posX: globalX,
        posY: globalY,
        sizeX: 1,
        sizeY: 1,
      };
      if (!licensesPromise) licensesPromise = client.update_license();
      try {
        if (tasks.length < EXPLORE_CONCURRENCY) {
          areas.push(area);
          tasks.push(client.post_explore(area));
        } else {
          const results = await Promise.all(tasks);
          client.exploreTries++;
          let count = 0;
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const area = areas[i];
            if (result && result.amount) {
              count++;
              client.digTasks[1].push({
                licenseID: -1,
                depth: 1,
                posX: area.posX,
                posY: area.posY,
              });
            }
          }
          await licensesPromise;
          client.exploreResults.push(count);
          tasks.length = 0;
          areas.length = 0;
          licensesPromise = null;
          if (client.digTasksSize() > client.get_digAllowed()) {
            await digWorker(client);
          }
        }
      } catch (error: unknown) {
        console.error('ERROR', error);
        await writeStats(client);
        await sleep(1000);
      }
    }
  }

  log('End. client stats: %o', client.stats);
};

game(apiClient);

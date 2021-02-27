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

import {performance} from 'perf_hooks';

// import {addLogger} from 'axios-debug-log';
import axios, {AxiosInstance, AxiosRequestConfig, AxiosResponse} from 'axios';
import debug, {Debugger} from 'debug';
import {asyncWorker, promise as fastQPromise} from 'fastq';
import PQueue from 'p-queue';

const STEP = 125;
console.debug('start ' + process.env.INSTANCE_ID, 'STEP', STEP);

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);

const client = axios.create({
  baseURL,
  validateStatus: () => true /*, timeout: 10*/,
});
const logger = debug('instance');
const log = logger.extend(String(process.env.INSTANCE_ID));

// const metricsInterval = setInterval(async () => {
//   logger(await promClient.register.metrics());
// }, 30000);
// metricsInterval.unref();

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
}

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

class APIClient {
  public stats = {
    dig: new CallStats(),
    cash: new CallStats(),
    licenseFree: new CallStats(),
    licensePaid: new CallStats(),
    licenseList: new CallStats(),
    explore: new CallStats(),
  };

  public digStats = new DigStats();

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
  readonly licenseCache: License[] = [];
  readonly start: number;
  constructor(client: AxiosInstance) {
    this.client = client;
    this.start = performance.now();
  }

  async post_license(coins: number[]): Promise<License | null> {
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
      this.stats.licensePaid.setTime(result.status, performance.now() - start);

      this.stats.licensePaid.error[result.status] =
        ++this.stats.licensePaid.error[result.status] || 1;
    } else {
      this.stats.licenseFree.setTime(result.status, performance.now() - start);

      this.stats.licenseFree.error[result.status] =
        ++this.stats.licenseFree.error[result.status] || 1;
    }
    return null;
  }

  async get_license(): Promise<License[] | null> {
    const start = performance.now();
    const result = await this.client.get<License[]>('/licenses');
    const isSuccess = result.status === 200;
    this.stats.licenseList.setTime(result.status, performance.now() - start);
    if (isSuccess) {
      this.stats.licenseList.success++;
      return result.data;
    }
    this.stats.licenseList.error[result.status] =
      ++this.stats.licenseList.error[result.status] || 1;
    return null;
  }

  async post_dig(dig: Dig): Promise<Treasure | null> {
    const start = performance.now();
    const result = await this.client.post<string[]>('/dig', dig);
    const isSuccess = result.status === 200;
    this.stats.dig.setTime(result.status, performance.now() - start);
    if (isSuccess) {
      this.stats.dig.success++;
      return {priority: 0, treasures: result.data};
    }
    this.stats.dig.error[result.status] =
      ++this.stats.dig.error[result.status] || 1;
    if (result.status === 403 && this.license) delete this.license;
    // logger('dig error, stats: %o', this.stats);
    return null;
  }

  async post_cash(treasure: string): Promise<number[] | null> {
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
    this.stats.cash.error[result.status] =
      ++this.stats.cash.error[result.status] || 1;
    return null;
  }

  async post_explore(area: Area): Promise<Explore | null> {
    const start = performance.now();
    const result = await this.client.post<Explore>('/explore', area);
    const isSuccess = result.status === 200;
    this.stats.cash.setTime(result.status, performance.now() - start);
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
    const start = performance.now();
    if (this.licenseCache.length) {
      this.license = this.licenseCache.pop();
    }
    if (this.wallet.balance) {
      const coin = this.wallet.wallet.shift();
      if (coin) {
        coins.push(coin);
        this.wallet.balance--;
      }
    }
    const license = await this.post_license(coins);
    if (license) {
      if (!this.license || this.license.digUsed >= this.license.digAllowed) {
        this.license = license;
      } else {
        this.licenseCache.push(license);
      }
    }
    return performance.now() - start;
  }

  async init_licenses(coins: number[] = []): Promise<number> {
    const globalStart = performance.now();
    let result: AxiosResponse<License>;
    do {
      const start = performance.now();
      result = await this.client.post<License>('/licenses', coins);
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
        this.licenseCache.push(result.data);
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
    } while (this.licenseCache.length < 2 && result.status !== 409);
    return performance.now() - globalStart;
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
  initArea: Area,
  exploresStore: Array<Explore>
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
        logger('area: %o; area0: %o; area1: %o;', area, areas[0], areas[1]);
      }

      const explore0 = explores[0];
      const explore1 = explores[1];

      if (explore0 && explore1) {
        if (explore0.amount > explore1.amount) {
          area = explore0.area;
          explore = explore0;
          if (explore1.amount) exploresStore.push(explore1);
        } else {
          area = explore1.area;
          explore = explore1;
          if (explore0.amount) exploresStore.push(explore0);
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
      // logger(await promClient.register.metrics());
      // sleep(100);
    }
  }
  return {area, explore};
};

const pq = new PQueue({concurrency: 1});

const makeCash = async function (
  client: APIClient,
  treasures: string[],
  amount: number,
  depth: number
) {
  for (const treasure of treasures) {
    const cash = await client.post_cash(treasure);
    if (cash) {
      try {
        client.digStats.cashByAmount[amount].push(cash.length);
        client.digStats.cashByDepth[depth].push(cash.length);
      } catch (error) {
        console.error(error);
        console.log(amount, depth);
      }
    }
  }
};

const makeCashWrapper = function (
  client: APIClient,
  treasures: string[],
  amount: number,
  depth: number
) {
  return async () => {
    await makeCash(client, treasures, amount, depth);
  };
};

const worker: asyncWorker<QContext, Explore, void> = async function (
  explore: Explore
) {
  const {client} = this;
  const {digStats} = client;

  let depth = 1;
  let left = explore.amount;
  while (depth <= 10 && left > 0) {
    while (
      !client.license ||
      client.license.digUsed >= client.license.digAllowed
    ) {
      await client.update_license();
    }
    const dig: Dig = {
      licenseID: client.license.id,
      posX: explore.area.posX,
      posY: explore.area.posY,
      depth,
    };

    const treasures = await client.post_dig(dig);
    if (treasures) {
      left--;
      digStats.amount[explore.amount]++;
      digStats.depth[depth]++;

      digStats.treasuresByAmount[explore.amount].push(
        treasures.treasures.length
      );
      digStats.treasuresByDepth[depth].push(treasures.treasures.length);

      pq.add(async () => {
        await makeCashWrapper(
          client,
          treasures.treasures,
          explore.amount,
          depth
        );
      });
    }
    client.license.digUsed++;
    depth++;
  }
};

// type QTask = {client: APIClient; explore: Explore; logger: Debugger};
type QContext = {client: APIClient; log: Debugger};
const workerDummy: asyncWorker<QContext, Explore, void> = async function (
  explore: Explore
) {
  const {log, client} = this;
  log('explore: %o, stats: %o', explore, client.stats);
  await sleep(300);
};

const noop = () => {};

const game = async (client: APIClient) => {
  const q = fastQPromise<{client: APIClient; log: Debugger}, Explore, void>(
    {client, log},
    worker,
    1
  );
    q.pause();
  client
    .init_licenses()
    .then(time =>
      log(
        'license id: %d licenseCacheLength: %d time: %d',
        client.license?.id,
        client.licenseCache.length,
        time
      )
    );

  const statsInterval = setInterval(async () => {
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
      'client qlen: %d, pqlen: %d, lcache: %d, total %d; errors: %d, rps: %d',
      q.length(),
      pq.size,
      client.licenseCache.length,
      total,
      errors,
      rps
      // client.digStats
      // client.stats
    );
  }, 5000);
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

    // Делители числа 1 750: 1, 2, 5, 7, 10, 14, 25, 35, 50, 70,  125,  175,  250,  350,  875, 1 750
    // Количество делителей: 16
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
            const explores = [explore];
            while (explores.length) {
              const baseExplore = explores.pop();
              if (baseExplore) {
                const {
                  explore: exploreWithTreasures,
                } = await findAreaWithTreasures(
                  log,
                  client,
                  baseExplore.area,
                  explores
                );

                if (exploreWithTreasures && exploreWithTreasures.amount) {
                  // if (q.length() > 10) await sleep(2000);
                  q.push(exploreWithTreasures);
                }
              }
            }
          }
        } catch (error: unknown) {
          noop();
          await sleep(100);
        }
      }
    }
  }

  log('End. client stats: %o', client.stats);
};

const apiClient = new APIClient(client);

game(apiClient);

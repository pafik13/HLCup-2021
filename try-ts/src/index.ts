type License = {
  id?: number;
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

import * as promClient from 'prom-client';
const apiMetrics = new promClient.Summary({
  name: 'rest_api',
  help: 'summary of rest api count and time',
  percentiles: [0.5, 0.999],
  labelNames: ['method', 'route', 'status', 'sizeX', 'sizeY'],
});

// import {addLogger} from 'axios-debug-log';
import axios, {AxiosInstance} from 'axios';
import debug, {Debugger} from 'debug';

console.debug('start ' + process.env.INSTANCE_ID);

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);

const client = axios.create({baseURL, validateStatus: () => true});
const logger = debug('instance');
// addLogger(client, logger);

// const metricsInterval = setInterval(async () => {
//   logger(await promClient.register.metrics());
// }, 30000);
// metricsInterval.unref();

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CallStats {
  public success = 0;
  public error = 0;
}

class APIClient {
  public stats = {
    dig: new CallStats(),
    cash: new CallStats(),
    license: new CallStats(),
    explore: new CallStats(),
  };

  private axiosConfigForCash = {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
    },
  };
  public client: AxiosInstance;
  public license?: License;
  constructor(client: AxiosInstance) {
    this.client = client;
  }

  async post_license(coin: number[]): Promise<License | null> {
    const end = apiMetrics.startTimer();
    const result = await this.client.post<License>('/licenses', coin);
    const isSuccess = result.status === 200;
    end({
      method: result.config.method,
      route: result.config.url,
      status: result.status,
    });
    if (isSuccess) {
      this.stats.license.success++;
      return result.data;
    }
    this.stats.license.error++;
    return null;
  }

  // async get_license(): Promise<License[] | null> {
  //   const end = apiMetrics.startTimer();
  //   const result = await this.client.get<License[]>('/licenses');
  //   const isSuccess = result.status === 200;
  //   end({
  //     method: result.config.method,
  //     route: result.config.url,
  //     status: result.status,
  //     response_size: result.status === 200 ? result.data.length : 0,
  //   });
  //   if (isSuccess) return result.data;
  //   return null;
  // }

  async post_dig(dig: Dig): Promise<Treasure | null> {
    const end = apiMetrics.startTimer();
    const result = await this.client.post<string[]>('/dig', dig);
    const isSuccess = result.status === 200;
    end({
      method: result.config.method,
      route: result.config.url,
      status: result.status,
    });
    if (isSuccess) {
      this.stats.dig.success++;
      return {priority: 0, treasures: result.data};
    }
    this.stats.dig.error++;
    if (result.status === 403 && this.license) delete this.license.id;
    return null;
  }

  async post_cash(treasure: string): Promise<number[] | null> {
    const end = apiMetrics.startTimer();
    const result = await this.client.post<number[]>(
      '/cash',
      JSON.stringify(treasure),
      this.axiosConfigForCash
    );
    const isSuccess = result.status === 200;
    end({
      method: result.config.method,
      route: result.config.url,
      status: result.status,
    });
    if (isSuccess) {
      this.stats.cash.success++;
      return result.data;
    }
    this.stats.cash.error++;
    return null;
  }

  async post_explore(area: Area): Promise<Explore | null> {
    const end = apiMetrics.startTimer();
    const result = await this.client.post<Explore>('/explore', area);
    const isSuccess = result.status === 200;
    end({
      method: result.config.method,
      route: result.config.url,
      status: result.status,
      sizeX: area.sizeX,
      sizeY: area.sizeY,
    });
    if (isSuccess) {
      this.stats.explore.success++;
      result.data.priority = 0;
      return result.data;
    }
    this.stats.explore.error++;
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

  async update_license(coins: number[] = []): Promise<void> {
    const license = await this.post_license(coins);
    if (license) {
      this.license = license;
    } else {
      //   this.licenseErrors++;
      await sleep(20 * Math.random());
    }
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
        logger('area: %o; area0: %o; area1: %o;', area, areas[0], areas[1]);
      }

      const explore0 = explores[0];
      const explore1 = explores[1];

      if (explore0 && explore1) {
        if (explore0.amount > explore1.amount) {
          area = explore0.area;
          explore = explore0;
        } else {
          area = explore1.area;
          explore = explore1;
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

const game = async (client: APIClient) => {
  const instanceId = Number(process.env.INSTANCE_ID);
  const log = logger.extend(String(instanceId));

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

  log('wholeExplore is started');
  const wholeExplore: Explore = {area: wholeArea, amount: 10}; //await client.post_explore(wholeArea);
  if (!wholeExplore) {
    log('wholeExplore is empty');
  } else {
    log('wholeExplore: %o', wholeExplore);

    // Делители числа 1 750: 1, 2, 5, 7, 10, 14, 25, 35, 50, 70,  125,  175,  250,  350,  875, 1 750
    // Количество делителей: 16
    const step = 125;
    for (let globalX = minX; globalX < maxX; globalX += step) {
      for (let globalY = minY; globalY < maxY; globalY += step) {
        const area: Area = {
          posX: globalX,
          posY: globalY,
          sizeX: step,
          sizeY: step,
        };
        try {
          const explore = await client.post_explore(area);
          if (explore && explore.amount) {
            const {explore: exploreWithTreasures} = await findAreaWithTreasures(
              log,
              client,
              area
            );

            if (exploreWithTreasures && exploreWithTreasures.amount) {
              let depth = 1;
              let left = exploreWithTreasures.amount;
              while (depth <= 10 && left > 0) {
                while (
                  !client.license ||
                  !client.license.id ||
                  client.license.digUsed >= client.license.digAllowed
                ) {
                  await client.update_license();
                }
                const dig: Dig = {
                  licenseID: client.license.id,
                  posX: exploreWithTreasures.area.posX,
                  posY: exploreWithTreasures.area.posY,
                  depth,
                };

                const treasures = await client.post_dig(dig);
                client.license.digUsed++;
                depth++;
                if (treasures) {
                  for (const treasure of treasures.treasures) {
                    const res = await client.post_cash(treasure);
                    if (res) left--;
                  }
                }
              }
            }
          }
        } catch (error: unknown) {
          log('global error: x=%d, y=%d, step=%d', globalX, globalY, step);
          if (error instanceof Error) {
            log('global error: %s', error.message);
          } else {
            log('global error: %o', error);
          }
        }
      }
    }
  }

  log('End. client stats: %o', client.stats);
};

const apiClient = new APIClient(client);

game(apiClient);

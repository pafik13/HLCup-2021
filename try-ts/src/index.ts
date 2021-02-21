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
  labelNames: ['method', 'route', 'status', 'response_size'],
});

// import {addLogger} from 'axios-debug-log';
import axios, {AxiosInstance} from 'axios';
import debug from 'debug';

console.debug('start ' + process.env.INSTANCE_ID);

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);

process.env.DEBUG = 'client';
const client = axios.create({baseURL, validateStatus: () => true});
const logger = debug('client');
// addLogger(client, logger);

// const metricsInterval = setInterval(async () => {
//   logger(await promClient.register.metrics());
// }, 30000);
// metricsInterval.unref();

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class APIClient {
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
      response_size: isSuccess ? 1 : 0,
    });
    if (isSuccess) return result.data;
    return null;
  }

  async get_license(): Promise<License[] | null> {
    const end = apiMetrics.startTimer();
    const result = await this.client.get<License[]>('/licenses');
    const isSuccess = result.status === 200;
    end({
      method: result.config.method,
      route: result.config.url,
      status: result.status,
      response_size: result.status === 200 ? result.data.length : 0,
    });
    if (isSuccess) return result.data;
    return null;
  }

  async post_dig(dig: Dig): Promise<Treasure | null> {
    const end = apiMetrics.startTimer();
    const result = await this.client.post<string[]>('/dig', dig);
    const isSuccess = result.status === 200;
    end({
      method: result.config.method,
      route: result.config.url,
      status: result.status,
      response_size: isSuccess ? result.data.length : 0,
    });
    if (isSuccess) return {priority: 0, treasures: result.data};
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
      response_size: isSuccess ? 1 : 0,
    });
    if (isSuccess) return result.data;
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
      response_size: isSuccess ? 1 : 0,
    });
    if (isSuccess) {
      result.data.priority = 0;
      return result.data;
    }
    if (result.status === 422) {
      throw Error('422');
    }
    return null;
  }

  async get_balance(): Promise<Wallet | null> {
    const end = apiMetrics.startTimer();
    const result = await this.client.get<Wallet>('balance');
    const isSuccess = result.status === 200;
    end({
      method: result.config.method,
      route: result.config.url,
      status: result.status,
      response_size: isSuccess ? 1 : 0,
    });
    if (isSuccess) return result.data;
    return null;
  }

  async update_license(coins: number[] = []): Promise<void> {
    const license = await this.post_license(coins);
    if (license) this.license = license;
    // } else {
    //   await sleep(20);
    //   const wallet = await this.get_balance();
    //   if (wallet) license = await this.post_license(wallet.wallet);
    // }
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
  client: APIClient,
  instanceId: number,
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
        logger(
          'instanceId: %d, area: %o; area0: %o; area1: %o;',
          instanceId,
          area,
          areas[0],
          areas[1]
        );
      }

      const explore0 = explores[0];
      const explore1 = explores[1];

      if (instanceId === 1) {
        logger(
          'instanceId: %d, area: %o; area0: %o; area1: %o; explore0: %o; explore1: %o',
          instanceId,
          area,
          areas[0],
          areas[1],
          explore0,
          explore1
        );
      }
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
        logger('global error: %s', error.message);
      } else {
        logger('global error: %o', error);
      }
      logger('area: %o', area);
      logger(await promClient.register.metrics());
      sleep(100);
    }
  }
  return {area, explore};
};

const game = async (client: APIClient) => {
  const instanceId = Number(process.env.INSTANCE_ID);

  const baseArea: Area = {
    posX: instanceId * 875,
    posY: instanceId * 875,
    sizeX: 875,
    sizeY: 875,
  };

  try {
    let i = 875 * 875;
    while (i--) {
      while (
        !client.license ||
        !client.license.id ||
        client.license.digUsed >= client.license.digAllowed
      ) {
        await client.update_license();
      }

      const {area, explore: maybyExplore} = await findAreaWithTreasures(
        client,
        instanceId,
        baseArea
      );
      let explore = maybyExplore;
      if (!explore) explore = await client.post_explore(area);
      if (!explore || !explore.amount) continue;

      let depth = 1;
      let left = explore.amount;
      while (depth <= 10 && left > 0) {
        const dig: Dig = {
          licenseID: client.license.id,
          posX: explore.area.posX,
          posY: explore.area.posY,
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
  } catch (error) {
    if (error instanceof Error) {
      logger('global error: %s', error.message);
    } else {
      logger('global error: %o', error);
    }
    logger(await promClient.register.metrics());
  }
};

const apiClient = new APIClient(client);

game(apiClient);

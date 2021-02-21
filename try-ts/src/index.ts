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

  // async post_license(coin: number[]): Promise<License | null> {
  //   const end = apiMetrics.startTimer();
  //   const result = await this.client.post<License>('/licenses', coin);
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

  // async post_dig(dig: Dig): Promise<Treasure | null> {
  //   const end = apiMetrics.startTimer();
  //   const result = await this.client.post<string[]>('/dig', dig);
  //   const isSuccess = result.status === 200;
  //   end({
  //     method: result.config.method,
  //     route: result.config.url,
  //     status: result.status,
  //     response_size: isSuccess ? result.data.length : 0,
  //   });
  //   if (isSuccess) return {priority: 0, treasures: result.data};
  //   if (result.status === 403 && this.license) delete this.license.id;
  //   return null;
  // }

  // async post_cash(treasure: string): Promise<number[] | null> {
  //   const end = apiMetrics.startTimer();
  //   const result = await this.client.post<number[]>(
  //     '/cash',
  //     JSON.stringify(treasure),
  //     this.axiosConfigForCash
  //   );
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
      result.data.priority = 0;
      return result.data;
    }
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

  // async update_license(coins: number[] = []): Promise<void> {
  //   const license = await this.post_license(coins);
  //   if (license) this.license = license;
  //   // } else {
  //   //   await sleep(20);
  //   //   const wallet = await this.get_balance();
  //   //   if (wallet) license = await this.post_license(wallet.wallet);
  //   // }
  // }
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

const game = async (client: APIClient) => {
  const instanceId = Number(process.env.INSTANCE_ID);

  const partSize = 875;
  const minX = instanceId * partSize;
  const minY = instanceId * partSize;
  const maxX = minX + partSize;
  const maxY = minY + partSize;
  const steps = [20, 25, 30];
  try {
    for (const step of steps) {
      for (let x = minX; x < maxX; x += step) {
        for (let y = minY; y < maxY; y += step) {
          const area: Area = {
            posX: x,
            posY: y,
            sizeX: step,
            sizeY: step,
          };
          await client.post_explore(area);
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger('global error: %s', error.message);
    } else {
      logger('global error: %o', error);
    }
    logger(await promClient.register.metrics());
  }
  logger(await promClient.register.metrics());
};

const apiClient = new APIClient(client);

game(apiClient);

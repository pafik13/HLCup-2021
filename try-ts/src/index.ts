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

  let emptyAreas = 0,
    areasWithTreasures = 0;
  const amounts = []
  // emtpyPoints = 0,
  // pointWithTreasures = 0;
  log('wholeExplore is started');
  const wholeExplore:Explore = { area: wholeArea, amount: 10  }//await client.post_explore(wholeArea);
  if (!wholeExplore) {
    log('wholeExplore is empty');
  } else {
    log('wholeExplore: %o', wholeExplore);

    // Делители числа 1 750: 1, 2, 5, 7, 10, 14, 25, 35, 50, 70,  125,  175,  250,  350,  875, 1 750
    // Количество делителей: 16
    const step = 175
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
            amounts.push(explore.amount)
            areasWithTreasures++;
          } else {
            emptyAreas++;
          }
        } catch (error: unknown) {
          log('global error: x=%d, y=%d, step=%d', globalX, globalY, step);
          if (error instanceof Error) {
            log('global error: %s', error.message);
          } else {
            log('global error: %o', error);
          }
          log(await promClient.register.metrics());
        }
      }
    }
  }
  log(
    'areas stats: empty=%d, with tresures=%d',
    emptyAreas,
    areasWithTreasures
  );
  log('amounts: %o', amounts)

  // log(
  //   'point stats: empty=%d, with tresures=%d',
  //   emtpyPoints,
  //   pointWithTreasures
  // );

  log(await promClient.register.metrics());
};

const apiClient = new APIClient(client);

game(apiClient);

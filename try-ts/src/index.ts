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
  labelNames: ['method', 'route', 'status', 'response_size'],
});

// import {addLogger} from 'axios-debug-log';
import axios, {AxiosError, AxiosInstance} from 'axios';
import debug from 'debug';
import config = require('axios-debug-log');

console.debug('start ' + process.env.INSTANCE_ID);

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);

process.env.DEBUG = 'client';
const client = axios.create({baseURL, validateStatus: () => true});
const logger = debug('client');
// addLogger(client, logger);

const metricsInterval = setInterval(() => {
  logger(promClient.register.metrics());
}, 30000);
metricsInterval.unref();

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
    const licence = await this.post_license(coins);
    if (licence) this.license = licence;
  }
}

const game = async (client: APIClient) => {
  // const wallet: Wallet = {
  //   balance: 0,
  //   wallet: [],
  // };
  const instanceId = Number(process.env.INSTANCE_ID);
  for (let x = instanceId * 875; x < (instanceId + 1) * 875; x++) {
    for (let y = instanceId * 875; y < (instanceId + 1) * 875; y++) {
      try {
        const area: Area = {
          posX: x,
          posY: y,
          sizeX: 1,
          sizeY: 1,
        };
        const explore = await client.post_explore(area);
        if (!explore || !explore.amount) continue;

        let depth = 1;
        let left = explore.amount;
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
            posX: x,
            posY: y,
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
      } catch (error: unknown) {
        if (error instanceof Error) {
          logger('global error: %s', error.message);
        } else {
          logger('global error: %o', error);
        }
        sleep(100);
      }
    }
  }
};

const apiClient = new APIClient(client);

game(apiClient);

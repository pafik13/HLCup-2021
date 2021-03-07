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
import debug from 'debug';

const MAX_PDIG_SIZE = Number(process.env.MAX_PDIG_SIZE) || 10;
const TASKS = Number(process.env.TASKS) || 100;
console.debug(
  'start ' + process.env.INSTANCE_ID,
  'MAX_PDIG_SIZE',
  MAX_PDIG_SIZE,
  'TASKS',
  TASKS
);

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);

const client = axios.create({
  baseURL,
  validateStatus: () => true /*, timeout: 10*/,
});

const logger = debug('instance');
const log = logger.extend(String(process.env.INSTANCE_ID));

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
    'client total %d; errors: %d, rps: %d; client stats: %o; exploreTries: %d; exploreResults:%d',
    total,
    errors,
    rps,
    client.stats,
    client.exploreTries,
    client.exploreResults.reduce((a, b) => a + b, 0)
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

class APIClient {
  public stats = {
    explore: new CallStats(),
  };
  public exploreTries = 0;
  public exploreResults: number[] = [];

  private axiosConfigForCash: AxiosRequestConfig = {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
    },
  };
  public client: AxiosInstance;
  readonly start: number;
  constructor(client: AxiosInstance) {
    this.client = client;
    this.start = performance.now();
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
}

const apiClient = new APIClient(client);

const game = async (client: APIClient) => {
  const statsInterval = setInterval(
    async () => await writeStats(client),
    15000
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

  const tasks: Promise<Explore | null>[] = [];
  const areas: Area[] = [];
  for (let globalX = minX; globalX < maxX; globalX += 1) {
    for (let globalY = minY; globalY < maxY; globalY += 1) {
      const area: Area = {
        posX: globalX,
        posY: globalY,
        sizeX: 1,
        sizeY: 1,
      };
      try {
        if (tasks.length < TASKS) {
          areas.push(area);
          tasks.push(client.post_explore(area));
        } else {
          const results = await Promise.all(tasks);
          client.exploreTries++;
          let count = 0;
          for (const result of results) {
            if (result && result.amount) count++;
          }
          client.exploreResults.push(count);
          tasks.length = 0;
          areas.length = 0;
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

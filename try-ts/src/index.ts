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

// import {addLogger} from 'axios-debug-log';
import axios, {AxiosInstance} from 'axios';
import debug from 'debug';

console.debug('start');

const baseURL = `http://${process.env.ADDRESS}:8000`;
console.debug('base url: ', baseURL);

process.env.DEBUG = 'client';
const client = axios.create({baseURL});
const logger = debug('client');
// addLogger(client, logger);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const game = async (client: AxiosInstance) => {
  const wallet: Wallet = {
    balance: 0,
    wallet: [],
  };
  for (let x = 0; x < 3500; x++) {
    for (let y = 0; y < 3500; y++) {
      const area: Area = {
        posX: x,
        posY: y,
        sizeX: 1,
        sizeY: 1,
      };
      let result;
      try {
        result = await client.post<Explore>('/explore', area);
      } catch (error) {
        logger('explore error %o', error);
      }
      if (!result) continue;

      const {data: explore} = result;
      let depth = 1;
      let left = explore.amount;
      let license: License = {
        digAllowed: 0,
        digUsed: 0,
      };
      while (depth <= 10 && left > 0) {
        await sleep(10);
        while (!license.id || license.digUsed >= license.digAllowed) {
          try {
            const {data} = await client.post<License>('/licenses', []);
            license = data;
          } catch (error) {
            // logger('licenses error %o', error);
          }
        }
        // logger(license)
        const dig: Dig = {
          licenseID: license.id,
          posX: x,
          posY: y,
          depth,
        };

        const treasureWrapper: Treasure = {
          priority: 0,
          treasures: [],
        };
        try {
          const {data} = await client.post<string[]>('/dig', dig);
          treasureWrapper.treasures = data;
        } catch (error) {
          // logger('dig error %o', error);
        }
        license.digUsed++;
        depth++;
        if (treasureWrapper.treasures.length) {
          for (const treasure of treasureWrapper.treasures) {
            try {
              const {data} = await client.post<number[]>('/cash', JSON.stringify(treasure), {
                headers: {
                  'Content-Type': 'application/json;charset=UTF-8',
                },
              });
              logger('cash %o', data);
              for (const cash of data) {
                wallet.wallet.push(cash);
              }
              left--;
            } catch (error) {
              logger('cash error %o', error);
            }
          }
        }
      }
    }
  }
};

game(client);

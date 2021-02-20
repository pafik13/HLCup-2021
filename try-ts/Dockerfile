FROM node:12-alpine as build-ts

WORKDIR /usr/src/app

COPY . .

RUN yarn

FROM node:12-alpine

WORKDIR /usr/src/app

COPY --from=build-ts /usr/src/app/build ./build
COPY --from=build-ts /usr/src/app/package.json /usr/src/app/yarn.lock ./

RUN yarn install --frozen-lockfile --production=true

ENV DEBUG client

CMD ["node", "build/src/index"]
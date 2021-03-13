FROM node:12-alpine as build-ts

WORKDIR /usr/src/app

COPY . .

RUN yarn

FROM keymetrics/pm2:12-alpine

WORKDIR /usr/app

COPY --from=build-ts /usr/src/app/build build/
COPY --from=build-ts /usr/src/app/package.json /usr/src/app/yarn.lock /usr/src/app/ecosystem.config.js ./

RUN yarn install --frozen-lockfile --production=true

ENV DEBUG instance:1
ARG GLOBAL_OFFSET_X=0
ENV GLOBAL_OFFSET_X=$GLOBAL_OFFSET_X
ARG GLOBAL_OFFSET_Y=0
ENV GLOBAL_OFFSET_Y=$GLOBAL_OFFSET_Y
ARG EXPLORE_CONCURRENCY=1
ENV EXPLORE_CONCURRENCY=$EXPLORE_CONCURRENCY
ARG EXPLORE_SIZE=16
ENV EXPLORE_SIZE=$EXPLORE_SIZE
ARG PRINT_STATS_TIME=60000
ENV PRINT_STATS_TIME=$PRINT_STATS_TIME
ARG PQCASH_CONCURRENCY=1
ENV PQCASH_CONCURRENCY=$PQCASH_CONCURRENCY

# Show current folder structure in logs
RUN ls -al -R

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]
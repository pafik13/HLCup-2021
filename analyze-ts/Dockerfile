FROM node:12-alpine as build-ts

WORKDIR /usr/src/app

COPY . .

RUN yarn

FROM keymetrics/pm2:12-alpine

WORKDIR /usr/app

COPY --from=build-ts /usr/src/app/build build/
COPY --from=build-ts /usr/src/app/package.json /usr/src/app/yarn.lock /usr/src/app/ecosystem.config.js ./
COPY --from=build-ts /usr/src/app/src/dig0.json /usr/src/app/src/dig1.json /usr/src/app/src/dig2.json /usr/src/app/src/dig3.json build/src/

RUN yarn install --frozen-lockfile --production=true

ENV DEBUG instance:1
ARG GLOBAL_OFFSET_X=0
ENV GLOBAL_OFFSET_X=$GLOBAL_OFFSET_X
ARG GLOBAL_OFFSET_Y=0
ENV GLOBAL_OFFSET_Y=$GLOBAL_OFFSET_Y
ENV EXPLORE_CONCURRENCY=50
ENV PQCASH_CONCURRENCY=40

# Show current folder structure in logs
RUN ls -al -R

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]
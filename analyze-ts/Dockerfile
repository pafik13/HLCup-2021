FROM node:12-alpine as build-ts

WORKDIR /usr/src/app

COPY . .

RUN yarn

FROM keymetrics/pm2:12-alpine

WORKDIR /usr/app

COPY --from=build-ts /usr/src/app/build build/
COPY --from=build-ts /usr/src/app/package.json /usr/src/app/yarn.lock /usr/src/app/ecosystem.config.js ./

RUN yarn install --frozen-lockfile --production=true

ENV DEBUG instance:*
ENV EXPLORE_CONCURRENCY=50
ENV PQCASH_CONCURRENCY=40

# Show current folder structure in logs
RUN ls -al -R

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]
FROM node:22.14.0-alpine3.21@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944
RUN addgroup -S -g 10001 sensor && adduser -S -D -H -u 10001 -G sensor sensor \
  && mkdir -p /app /data && chown -R sensor:sensor /app /data \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --chown=sensor:sensor index.js /app/index.js
USER sensor
EXPOSE 1514 4010
CMD ["node", "/app/index.js"]

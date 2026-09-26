FROM node:22.22.3-alpine3.22@sha256:cd7807368cf24826297cbad5dca1a44972ccfd770647db52a8c7589eb4599ac8 AS base
ENV PNPM_HOME=/pnpm
ENV COREPACK_HOME=/pnpm/corepack
ENV HOME=/tmp
ENV PATH=$PNPM_HOME:$PATH
RUN apk upgrade --no-cache \
  && corepack enable \
  && corepack prepare pnpm@10.34.4 --activate
WORKDIR /app

FROM base AS dependencies
COPY . .
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
ARG APP_FILTER
ARG NEXT_PUBLIC_API_URL=/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm db:generate
RUN test -n "$APP_FILTER" && pnpm --filter "$APP_FILTER"... build

FROM builder AS production-dependencies
ARG APP_FILTER
RUN pnpm --filter "$APP_FILTER" deploy --prod --legacy /prod/app
RUN generated="$(find /app/node_modules/.pnpm -path '*/node_modules/.prisma/client' -type d | head -n 1)" \
  && prisma_package="$(find /prod/app/node_modules/.pnpm -path '*/node_modules/@prisma/client' -type d | head -n 1)" \
  && if [ -n "$prisma_package" ]; then \
       test -n "$generated"; \
       prisma_modules="$(dirname "$(dirname "$prisma_package")")"; \
       mkdir -p "$prisma_modules/.prisma"; \
       cp -R "$generated" "$prisma_modules/.prisma/client"; \
     fi

FROM builder AS migrator
ENV NODE_ENV=production
ENV APP_FILTER=@honeypot/database
ENV APP_COMMAND=prisma:deploy
ENV INTERNAL_SERVICE_URLS=1
RUN addgroup -S -g 10001 honeypot && adduser -S -D -H -u 10001 -G honeypot honeypot
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* /pnpm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER honeypot
ENTRYPOINT ["sh", "/app/scripts/container-entrypoint.sh"]

FROM base AS runtime
ARG APP_FILTER
ARG APP_COMMAND=start
ENV NODE_ENV=production
ENV APP_FILTER=$APP_FILTER
ENV APP_COMMAND=$APP_COMMAND
ENV DEPLOYED_PACKAGE=1
RUN addgroup -S -g 10001 honeypot && adduser -S -D -H -u 10001 -G honeypot honeypot
COPY --from=production-dependencies --chown=honeypot:honeypot /prod/app /app
COPY --from=builder --chown=honeypot:honeypot /app/scripts/container-entrypoint.sh /app/scripts/container-entrypoint.sh
RUN mkdir -p /app/data && chown honeypot:honeypot /app/data \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* /pnpm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg
USER honeypot
ENTRYPOINT ["sh", "/app/scripts/container-entrypoint.sh"]

FROM node:22.14.0-alpine3.21
WORKDIR /app
COPY mock-control-plane.mjs /app/mock-control-plane.mjs
USER node
EXPOSE 4088
CMD ["node", "/app/mock-control-plane.mjs"]

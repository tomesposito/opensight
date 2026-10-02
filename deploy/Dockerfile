# Supply an operator-reviewed Node 24 Linux image already present locally.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
RUN npm ci --no-audit --no-fund
RUN npm run build
FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "packages/api/dist/reference-cli.js"]

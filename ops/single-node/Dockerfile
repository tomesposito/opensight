# REFERENCE HARNESS: pilot, single-node, no HA claims; ephemeral Blaze.
# Actual deployment requires separate authorization. Base images are operator selected.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci && npm run build --workspace @opensight/api
USER node
ENTRYPOINT ["node", "packages/api/dist/single-node-cli.js"]
CMD ["serve"]

ARG NODE_IMAGE=node:24.22.3-bookworm-slim
ARG POSTGRES_TOOLS_IMAGE=postgres:18-bookworm
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4785 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./
USER node
EXPOSE 4785
VOLUME /data
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4785)+'/api/ready',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node","dist/server/server.js"]

# Optional operations image: the same compiled code, plus official PostgreSQL clients.
# Keep Node and PostgreSQL tools on the same Debian release.
FROM ${POSTGRES_TOOLS_IMAGE} AS operations
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libatomic1 && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 node && useradd --uid 1000 --gid node --create-home node \
    && mkdir /data && chown node:node /data
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /app
COPY --from=runtime /app /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4785 DATA_DIR=/data
USER node
ENTRYPOINT []
CMD ["node","dist/server/cli/migrate.js"]

# The default build remains the small application image.
FROM runtime AS final

FROM node:22-bookworm-slim

ARG IPOLLOWORK_ORCHESTRATOR_VERSION=0.11.22

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    tar \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "ipollowork-orchestrator@${IPOLLOWORK_ORCHESTRATOR_VERSION}"

# Persistent directories (mount volumes here on PaaS/SSH).
ENV IPOLLOWORK_DATA_DIR=/data/ipollowork-orchestrator
ENV IPOLLOWORK_SIDECAR_DIR=/data/sidecars

# The workspace is mounted from the host/volume.
ENV IPOLLOWORK_WORKSPACE=/workspace

# iPolloWork host contract surface.
EXPOSE 8787

VOLUME ["/workspace", "/data"]

# Defaults:
# - iPolloWork server is published intentionally via --remote-access
# - OpenCode stays internal (127.0.0.1:4096)
# - iPolloWork server proxies OpenCode via localhost
CMD [
  "ipollowork",
  "serve",
  "--workspace", "/workspace",
  "--remote-access",
  "--ipollowork-port", "8787",
  "--opencode-host", "127.0.0.1",
  "--opencode-port", "4096",
  "--connect-host", "127.0.0.1",
  "--cors", "*",
  "--approval", "manual"
]

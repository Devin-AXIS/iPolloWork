# Alibaba Agent Sandbox generation-2 image; publish with a versioned tag.
ARG NODE_IMAGE=node:24.22.3-bookworm-slim
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends systemd systemd-sysv openssh-server openssh-client sudo chrony fuse3 iptables bash ca-certificates git curl python3 util-linux build-essential \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/ipollowork
COPY ipollo-dsh-suite.tgz /tmp/suite.tgz
COPY runtime.package.json ./package.json
RUN npm install --omit=dev --save-exact @deepseek-ai/dsh@0.2.2-rc.3 /tmp/suite.tgz \
    && ln -s /opt/ipollowork/node_modules/@ipollo/dsh-suite /opt/ipollowork/suite \
    && mkdir /opt/ipollowork/bin \
    && ln -s /opt/ipollowork/node_modules/.bin/dsh /opt/ipollowork/bin/dsh \
    && DSH_HOME=/opt/ipollowork/profile-seed /opt/ipollowork/bin/dsh plugin --profile web add link:/opt/ipollowork/node_modules/@ipollo/dsh-suite \
    && rm /tmp/suite.tgz
ENV NODE_ENV=production
CMD ["/sbin/init"]

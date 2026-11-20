import { serve } from '@hono/node-server';
import { isIP } from 'node:net';
import { Server } from 'node:http';
import type { Config } from './config.js';
import type { createService } from './app.js';

/** The production listener is also exercised by HTTP capacity and drain tests. */
export function startHttpService(config: Config, service: Awaited<ReturnType<typeof createService>>, listening?: () => void) {
  const server = serve({
    fetch: (request, env) => {
      const headers = new Headers(request.headers);
      const peer = (env.incoming.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
      const forwarded = headers.get('x-real-ip') ?? '';
      headers.set('x-ipollo-peer-ip', config.trustedProxyIps.includes(peer) && isIP(forwarded) ? forwarded : peer);
      return service.app.fetch(new Request(request, { headers }), env);
    },
    hostname: config.host, port: config.port,
  }, listening);
  if (!(server instanceof Server)) throw new Error('Liveshare requires the Node HTTP server');
  server.headersTimeout = 15000;
  server.requestTimeout = 600000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 1024;
  server.maxRequestsPerSocket = 1000;
  const detachRelay = service.relay.attach(server);
  let stopping: Promise<void> | undefined;
  return { server, stop(): Promise<void> {
    return stopping ??= new Promise((resolve, reject) => {
      service.beginDrain();
      detachRelay();
      const timer = setTimeout(() => server.closeAllConnections(), config.shutdownGraceMs);
      timer.unref();
      void service.relay.close().catch(() => console.error('Share relay shutdown failed'));
      server.close(() => {
        void service.close().then(resolve, reject).finally(() => clearTimeout(timer));
      });
      server.closeIdleConnections();
    });
  } };
}

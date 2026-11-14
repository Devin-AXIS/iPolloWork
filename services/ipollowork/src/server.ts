import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createService } from "./app.js";
import { loadConfig } from "./config.js";
import { isIP } from "node:net";
import { Server } from 'node:http';

if (existsSync(".env")) process.loadEnvFile(".env");
const config = loadConfig();
const service = await createService(config);
const server = serve({ fetch: (request, env) => {
  const headers = new Headers(request.headers);
  const peer = (env.incoming.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const forwarded = headers.get("x-real-ip") ?? "";
  headers.set("x-ipollo-peer-ip", config.trustedProxyIps.includes(peer) && isIP(forwarded) ? forwarded : peer);
  return service.app.fetch(new Request(request, { headers }), env);
}, hostname: config.host, port: config.port }, () => {
  console.log("iPolloWork services: " + config.origin);
});
if (!(server instanceof Server)) throw new Error('Liveshare requires the Node HTTP server');
const detachRelay = service.relay.attach(server);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  detachRelay(); service.relay.close();
  server.close(() => { service.close(); process.exit(0); });
});

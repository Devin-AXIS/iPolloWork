import { loadEnvironment } from './environment.js';
import { createService } from "./app.js";
import { loadConfig } from "./config.js";
import { startHttpService } from './http-server.js';

loadEnvironment();
const config = loadConfig();
const service = await createService(config);
const http = startHttpService(config, service, () => console.log('iPolloWork services: ' + config.origin));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    const deadline = setTimeout(() => { console.error('Service shutdown deadline exceeded'); process.exit(1); }, config.shutdownGraceMs + 10000);
    deadline.unref();
    void http.stop().then(() => process.exit(0), () => { console.error('Service shutdown failed'); process.exit(1); });
  });

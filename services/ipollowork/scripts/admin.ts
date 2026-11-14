import { existsSync } from "node:fs";
import { createService } from "../src/app.js";
import { loadConfig } from "../src/config.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const email = process.argv[2], name = process.argv[3] ?? "管理员";
if (!email || !process.env.ADMIN_PASSWORD) throw new Error("Usage: ADMIN_PASSWORD=… npm run admin -- email [name]");
const service = await createService(loadConfig());
try {
  const existing = service.store.one('SELECT id FROM "user" WHERE email=?', email.toLowerCase());
  if (existing) throw new Error("Account already exists; use an authenticated admin to change its role.");
  const result = await service.auth.api.signUpEmail({ body: { email, name, password: process.env.ADMIN_PASSWORD } });
  service.store.run('UPDATE "user" SET role=?,emailVerified=1 WHERE id=?', "admin", result.user.id);
  console.log("Administrator created.");
} finally { service.close(); }

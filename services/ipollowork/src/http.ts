import type { Hono } from "hono";
import type { Actor } from "./auth.js";
export type App = Hono<{ Variables: { actor: Actor; cloudGrant?: import("./cloud-projects.js").CloudGrant } }>;

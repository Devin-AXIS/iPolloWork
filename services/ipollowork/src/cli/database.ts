import { createAuth } from '../auth.js';
import type { Config } from '../config.js';
import { Store, migrate } from '../database.js';

/** Operator commands migrate without starting cleanup workers or HTTP listeners. */
export async function openOperatorDatabase(config: Config) {
  const store = new Store(config);
  try {
    const auth = await createAuth(config, store);
    await migrate(store, config);
    return { store, auth };
  } catch (error) {
    await store.close();
    throw error;
  }
}

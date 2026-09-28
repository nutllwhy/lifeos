import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) {
    throw new Error(
      "Database binding `DB` is unavailable. Check the `d1_databases` section of vite.config.ts."
    );
  }

  return drizzle(bindings.DB, { schema });
}

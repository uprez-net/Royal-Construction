import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  /**
   * CONNECTION POOLING
   */
  max: process.env.NODE_ENV === "production" ? 10 : 5,
  min: 1,

  /**
   * CONNECTION LIFECYCLE
   */
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  maxUses: 7_500,
  maxLifetimeSeconds: 60 * 30,

  /**
   * SERVERLESS / DEV FRIENDLY
   */
  allowExitOnIdle: true,

  /**
   * KEEP ALIVE
   */
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,

  /**
   * QUERY SAFETY
   */
  statement_timeout: 15_000,
  query_timeout: 15_000,
  lock_timeout: 10_000,
  idle_in_transaction_session_timeout: 15_000,

  /**
   * SSL
   */
  ssl: {
    rejectUnauthorized: true,
  },

  /**
   * IDENTIFICATION
   */
  application_name: process.env.NODE_ENV === "production" ? "royal-construction-prod" : "royal-construction-dev",

  /**
   * HOOK
   */
  onConnect(client) {
    client.query(`
      SET timezone = 'UTC';
    `);
  },
});
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
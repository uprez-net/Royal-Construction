import { serve } from "@hono/node-server";

import { readConfig } from "./config.js";
import { EventOutbox } from "./events/outbox.js";
import { createApp } from "./http/app.js";
import { createLogger } from "./logger.js";
import { MappingStore } from "./store/mappings.js";
import { MediaStore } from "./store/media.js";
import { SentMessageStore } from "./store/sent-messages.js";
import { BaileysSession } from "./whatsapp/session.js";

// Start-up: read the config (refusing to run without a token), open the
// stores on the data volume, start delivering queued events, connect the
// WhatsApp session if it was linked before, and serve the API.

const config = readConfig();
const logger = createLogger(config.logLevel);

const mappings = new MappingStore(config.dataDir);
const media = new MediaStore(config.dataDir);
const sent = new SentMessageStore(config.dataDir);
const outbox = new EventOutbox({
  dataDir: config.dataDir,
  logger: logger.child({ component: "outbox" }),
  secret: config.webhookSecret,
  url: config.appWebhookUrl,
});
const session = new BaileysSession({
  dataDir: config.dataDir,
  logger,
  mappings,
  media,
  mediaMaxBytes: config.mediaMaxBytes,
  outbox,
  sent,
});

if (!config.appWebhookUrl) {
  logger.warn(
    "APP_WEBHOOK_URL is not set: events are queued on disk and not delivered.",
  );
}

await outbox.start();
await session.start();

const app = createApp({
  apiToken: config.apiToken,
  client: session,
  logger,
  mappings,
  media,
  outboxHealth: () => outbox.health(),
  sent,
});

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  (info) => {
    logger.info({ port: info.port }, "WhatsApp bridge listening");
  },
);

const prune = async () => {
  const removed = await media.prune(config.mediaRetentionDays).catch(() => 0);
  if (removed > 0) logger.info({ removed }, "pruned old media");
};
void prune();
const pruneTimer = setInterval(() => void prune(), 6 * 60 * 60 * 1000);
pruneTimer.unref();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, "shutting down");
  clearInterval(pruneTimer);
  outbox.stop();
  await session.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

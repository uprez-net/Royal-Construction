import { pino, type Logger } from "pino";

// One pino logger for the bridge and a quieter child for Baileys, whose debug
// output is every binary frame. Logs carry ids, counts and states — never a
// message body, a name or a phone number.

export function createLogger(level: string): Logger {
  return pino({
    base: { service: "whatsapp-bridge" },
    level,
    redact: {
      censor: "[redacted]",
      paths: ["*.text", "*.body", "*.caption", "*.phoneE164", "*.pushName"],
    },
  });
}

export function baileysLogger(logger: Logger): Logger {
  const child = logger.child({ class: "baileys" });
  // Baileys at "info" narrates every reconnect and sync; warnings are enough.
  child.level =
    logger.level === "debug" || logger.level === "trace"
      ? logger.level
      : "warn";
  return child;
}

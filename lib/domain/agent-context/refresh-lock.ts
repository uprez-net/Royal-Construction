import type { DomainDb } from "../db";
import { DomainTransitionError } from "../errors";

// One document refresh at a time.
//
// A refresh loads the live set once, then spends minutes reading documents
// before it writes their passages. A second run that starts meanwhile (the
// nightly cron and a hand-run drain of the backlog) sweeps what has left the
// live set, and the first run would then write those documents back from its
// stale list. So a run takes this lock before it loads anything, and a queued
// run loads its live set only after the one ahead of it has finished.
//
// The lock is a transaction-scoped advisory lock, held by a transaction that
// does nothing else: the refresh itself runs on the ordinary client, so its
// writes commit as they go and a failed run keeps what it already did. The
// pool's idle-in-transaction and lock timeouts (lib/prisma.ts) are 15s and 10s,
// so waiting polls a try-lock rather than blocking, and the holder pings. If
// the process is stopped the pings stop, Postgres ends the transaction, and
// the lock goes with it.

const LOCK_KEY = "agent-context:files:refresh";
const POLL_MS = 2_000;
const PING_MS = 5_000;
/** How long a queued run waits for the one ahead when it has no deadline. */
const DEFAULT_WAIT_MS = 60_000;
/** Longer than a function may run (maxDuration is 300s). */
const MAX_HOLD_MS = 330_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function acquire(db: DomainDb, giveUpAt: number): Promise<void> {
  for (;;) {
    const [row] = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${LOCK_KEY}, 0)) AS "locked"`;
    if (row?.locked) return;
    if (Date.now() >= giveUpAt) {
      throw new DomainTransitionError(
        "The document index is already being refreshed. Try again once that run has finished.",
      );
    }
    await sleep(POLL_MS);
  }
}

/**
 * Run `run` while holding the refresh lock, waiting for a run ahead of it
 * until `deadline` (or a minute). Inside a caller's own transaction the lock
 * lasts as long as that transaction does.
 */
export async function withRefreshLock<T>(
  db: DomainDb,
  deadline: Date | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const giveUpAt = deadline?.getTime() ?? Date.now() + DEFAULT_WAIT_MS;
  if (!("$transaction" in db)) {
    await acquire(db, giveUpAt);
    return run();
  }
  return db.$transaction(
    async (tx) => {
      await acquire(tx, giveUpAt);
      const ping = setInterval(() => {
        tx.$queryRaw`SELECT 1`.catch((error: unknown) => {
          console.error(
            "[agent-files] refresh lock ping failed; the lock may be lost",
            error instanceof Error ? error.message : error,
          );
        });
      }, PING_MS);
      try {
        return await run();
      } finally {
        clearInterval(ping);
      }
    },
    { maxWait: 10_000, timeout: MAX_HOLD_MS },
  );
}

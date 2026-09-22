"use client";

import { useState } from "react";

import {
  createAttemptKey,
  createAttemptKeys,
  type AttemptKeys,
} from "@/lib/idempotency/attempt-key";

/**
 * One key per intent, not one per click.
 *
 * The compliance send routes and the team invite/revoke routes read an
 * `Idempotency-Key` header and pass it to the domain, which uses it as the
 * OutboxEvent key. When the header is absent the domain derives one instead,
 * and those derived keys are what this exists to replace: the compliance
 * follow-up falls back to `<outreach>:follow-up:<alert>:<day>`, so a second
 * follow-up the office genuinely means to send on the same day finds a
 * SUCCEEDED row and is reported as sent while nothing leaves the building.
 * That is the silent-failure case — the first sign is the consultant saying
 * they were never chased.
 *
 * A key minted fresh on every click would fix that and break something worse:
 * `fetchJson` does not retry, so two clicks would carry two keys and send a
 * consultant two emails. The key therefore belongs to the attempt, and is held
 * until that attempt succeeds:
 *
 * - a double click, or a second click landing before React commits the pending
 *   state, reuses the key and is deduplicated by the outbox;
 * - a retry after a timeout reuses the key, so a send the server already
 *   committed comes back as the outbox's explicit "needs reconciliation"
 *   refusal rather than as a second email;
 * - a deliberate later send rotates onto a new key and actually goes out.
 *
 * Rotation is on success only. A failed attempt keeps its key on purpose: a
 * provider may have accepted a request whose response never arrived, and for
 * something a client reads, refusing loudly beats sending twice.
 *
 * The rule itself lives in lib/idempotency/attempt-key.ts so it can be tested;
 * this is the once-per-mount holder around it. A lazy `useState` initializer
 * rather than a ref, because the holder has to survive re-renders and reading
 * a ref during render is what `react-hooks/refs` forbids — the state is never
 * set again, so this costs nothing and never re-renders.
 */
export function useIdempotencyKey() {
  const [holder] = useState(createAttemptKey);
  return holder;
}

/**
 * The same thing for a caller that serves many targets at once.
 *
 * A compliance modal is opened for one party, so one key is all it needs. A
 * hook behind a list — the team screen, where every row has its own invite or
 * revoke — would otherwise share one key across different people, and a failed
 * invite to one address would hand its key to the next address and have the
 * outbox refuse it. The target id keeps them apart.
 */
export function useIdempotencyKeys(): AttemptKeys {
  const [holder] = useState(createAttemptKeys);
  return holder;
}

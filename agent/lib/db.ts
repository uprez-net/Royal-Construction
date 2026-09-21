import prisma from "@/lib/prisma";
import type { DomainDb, TransactionalDomainDb } from "@/lib/domain/db";

// The one place an Eve specialist gets a database handle.
//
// Issue #301's rule is that agent/lib/*-operations.ts may not import
// @/lib/prisma: a specialist holding the client is how it ends up writing its
// own copy of a business rule, which is the whole failure this migration is
// about. But a read path still needs a client to hand the domain command, and
// runAuditedAgentOperation only supplies one inside a transaction.
//
// So the handle is named here, in agent infrastructure, alongside channel
// authentication, the actor lookup and the audit/idempotency gate — the
// modules tests/architecture/agent-operations-prisma.test.ts exempts by name.
// A specialist imports `agentDb` and passes it straight into a lib/domain
// function. If you find yourself writing `agentDb.offer.update(...)` in a
// specialist, that is the thing this seam exists to make visible: the command
// belongs in lib/domain.

export const agentDb: TransactionalDomainDb = prisma;

/** The caller's transaction if it has one, otherwise the shared client. */
export function agentDbFor(transaction?: DomainDb): DomainDb {
  return transaction ?? agentDb;
}

import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * The database a domain function runs against.
 *
 * Every domain function takes one explicitly rather than importing the ambient
 * client, so the same function composes inside a caller's transaction — an Eve
 * tool's `runAuditedAgentOperation`, a multi-step Server Action — or runs on
 * its own. `Prisma.TransactionClient` is the narrower of the two: it lacks
 * `$transaction`, so a function that needs to open one must say so in its own
 * signature instead of taking `DomainDb`.
 *
 * Deliberately typed off `PrismaClient` rather than `typeof prisma`: importing
 * `@/lib/prisma` for a type would pull the client instance into every domain
 * module's import graph.
 */
export type DomainDb = Prisma.TransactionClient | PrismaClient;

/**
 * A database handle that can open a transaction.
 *
 * Use this for a command that must own its transaction boundary. A caller
 * already inside a transaction cannot satisfy it, which is the point: nested
 * `$transaction` calls on a `TransactionClient` are not available, and a
 * command that silently ran non-transactionally would be worse.
 */
export type TransactionalDomainDb = PrismaClient;

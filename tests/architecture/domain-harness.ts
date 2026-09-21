import type { DomainDb, TransactionalDomainDb } from "../../lib/domain/db";
import type { DomainPrincipal } from "../../lib/domain/principal";
import { Role } from "@prisma/client";

// The harness contract tests use to drive a domain command through more than
// one adapter (issue #301).
//
// The point of the domain layer is that the App adapter and the Eve adapter
// run the *same* rule. That is only worth asserting if a test can actually run
// the rule, and no test in this repo touches a database — they are static and
// unit tests, deliberately, because there is no test database to run against.
//
// So the database is the thing we fake. A domain function takes its DomainDb
// explicitly (lib/domain/README.md), which makes this possible without a
// mocking framework: hand it a recorder, script the reads it performs, and
// assert on the writes it attempted. Two adapters calling the same command
// with the same input must produce the same recorded writes.

type Call = {
  /** e.g. "offer.update" */
  readonly operation: string;
  readonly args: unknown;
};

/** What a scripted read returns, or a function of the query it received. */
type Script = Record<string, unknown | ((args: unknown) => unknown)>;

export type RecordingDb = {
  readonly db: DomainDb;
  /**
   * The same recorder, for a command that insists on owning its transaction.
   *
   * `TransactionalDomainDb` is the real `PrismaClient`, which this fake cannot
   * structurally be — it implements `$transaction` and the model methods and
   * nothing else. The cast is the whole point of the harness: `$transaction`
   * runs the callback against the same recorder, so a command that opens its
   * own transaction is still recorded flat, in order.
   */
  readonly transactionalDb: TransactionalDomainDb;
  /** Every model operation performed, in order. */
  readonly calls: readonly Call[];
  /** Just the mutations, for comparing two adapters' effects. */
  writes(): readonly Call[];
  /** Operation names in order, the cheapest thing to assert on. */
  operations(): readonly string[];
};

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "delete",
  "deleteMany",
  "update",
  "updateMany",
  "upsert",
]);

const READ_OPERATIONS = new Set([
  "aggregate",
  "count",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
]);

/**
 * A `DomainDb` that records what a command did and answers reads from a script.
 *
 * Script keys are `"<model>.<operation>"`. An unscripted read throws rather
 * than returning undefined: a command that silently proceeds on a missing row
 * is exactly the bug these tests exist to catch, and a test that did not say
 * what the database contains has not specified the case it is testing.
 * Unscripted *writes* return `{ count: 1 }`-ish acknowledgements, because a
 * command usually ignores a write's return value.
 *
 * `$transaction` runs the callback against the same recorder, so a command
 * that opens its own transaction is recorded flat, in order.
 */
export function recordingDb(script: Script = {}): RecordingDb {
  const calls: Call[] = [];

  const answer = (operation: string, args: unknown): unknown => {
    const scripted = script[operation];
    if (typeof scripted === "function") {
      return (scripted as (args: unknown) => unknown)(args);
    }
    if (operation in script) return scripted;

    const [, verb] = operation.split(".");
    if (WRITE_OPERATIONS.has(verb)) {
      if (verb === "createManyAndReturn") return [];
      return verb.endsWith("Many") ? { count: 1 } : {};
    }
    throw new Error(
      `recordingDb: unscripted read ${operation}. Add it to the script so the test says what the database contains.`,
    );
  };

  const model = (name: string) =>
    new Proxy(
      {},
      {
        get(_target, verb: string) {
          if (!WRITE_OPERATIONS.has(verb) && !READ_OPERATIONS.has(verb)) {
            return undefined;
          }
          return async (args: unknown) => {
            const operation = `${name}.${verb}`;
            calls.push({ args, operation });
            return answer(operation, args);
          };
        },
      },
    );

  const models = new Map<string, unknown>();

  const db = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === "$transaction") {
          return (
            argument:
              | ((tx: DomainDb) => Promise<unknown>)
              | readonly Promise<unknown>[],
          ) =>
            typeof argument === "function"
              ? argument(db as DomainDb)
              : Promise.all(argument);
        }
        // Raw SQL is recorded, not executed. The only domain use is the
        // advisory lock behind the lead dedupe, where what matters to a test
        // is that the lock was taken before the read — the row count it
        // returns is not read by anything.
        if (property === "$executeRaw" || property === "$executeRawUnsafe") {
          return (...args: unknown[]) => {
            calls.push({ args, operation: `$.${property.slice(1)}` });
            return Promise.resolve(1);
          };
        }
        if (typeof property !== "string" || property.startsWith("$")) {
          return undefined;
        }
        if (!models.has(property)) models.set(property, model(property));
        return models.get(property);
      },
    },
  ) as DomainDb;

  return {
    calls,
    db,
    transactionalDb: db as unknown as TransactionalDomainDb,
    operations: () => calls.map((call) => call.operation),
    writes: () =>
      calls.filter((call) =>
        WRITE_OPERATIONS.has(call.operation.split(".")[1]),
      ),
  };
}

/** A signed-in ADMIN — which is every member of staff on the shared login. */
export function adminPrincipal(userId = "user_admin"): DomainPrincipal {
  return { kind: "user", role: Role.ADMIN, userId };
}

/** A signed-in site manager, for the scoping rules Projects will need. */
export function siteManagerPrincipal(
  userId = "user_site_manager",
): DomainPrincipal {
  return { kind: "user", role: Role.SITE_MANAGER, userId };
}

/** A customer-portal account: internal to nothing. */
export function customerPrincipal(userId = "user_customer"): DomainPrincipal {
  return { kind: "user", role: Role.CUSTOMER, userId };
}

/**
 * Assert that two adapters produced the same effect from the same input.
 *
 * Compares the mutations, not the reads: an adapter may legitimately read more
 * (a page loading a header alongside the record it is about to change), but if
 * the two write differently then the rule has two implementations again, which
 * is the whole failure this migration exists to end.
 */
export function assertSameWrites(
  a: RecordingDb,
  b: RecordingDb,
  assertDeepEqual: (
    actual: unknown,
    expected: unknown,
    message: string,
  ) => void,
  label: string,
): void {
  assertDeepEqual(
    b.writes(),
    a.writes(),
    `${label}: the two adapters wrote different things, so they are not calling the same domain command.`,
  );
}

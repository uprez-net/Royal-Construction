import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  EVAL_AUTH_HEADER,
  EVAL_SESSION_HEADER,
  EVAL_TOKEN_TTL_SECONDS,
  sessionIdFromJwt,
} from "@/lib/eval/staging-auth";

/**
 * Run the Eve eval suite against a staging deployment.
 *
 * The primary documented flow, replacing "export a Clerk session token by
 * hand and hope it is the right one". This wrapper:
 *
 *   1. proves possession of the shared secret to the staging bootstrap route;
 *   2. gets back a five-minute Clerk session token for the dedicated eval user;
 *   3. checks the target is the deployment and database the operator meant,
 *      and that the agent is actually switched on there;
 *   4. runs `eve eval` with the token in the child's environment only;
 *   5. revokes the Clerk session on the way out, whatever happened.
 *
 * The token is never written to disk, never printed, and never passed as an
 * argv value — argv is world-readable in a process listing on most systems,
 * which is why it goes through the environment instead.
 *
 * The developer machine needs `EVE_EVAL_AUTH_SECRET` and a target URL. It does
 * not need `CLERK_SECRET_KEY`: only the deployment can mint a session, which
 * is the point of putting the bootstrap there.
 */

type BootstrapResponse = {
  readonly token?: unknown;
  readonly expiresInSeconds?: unknown;
  readonly environment?: unknown;
  readonly deployment?: unknown;
  readonly databaseLabel?: unknown;
  readonly fixtureVersion?: unknown;
  readonly operationsAgentEnabled?: unknown;
  readonly specialistsEnabled?: unknown;
};

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Exported for tests: the target allow-listing is the whole guard. */
export function targetUrlFrom(args: readonly string[]): URL {
  const raw = valueAfter(args, "--url") ?? process.env.STAGING_URL;
  if (!raw) throw new Error("Set STAGING_URL or pass --url <staging-url>.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The staging target must be a valid URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "The staging target must be an HTTPS URL without credentials.",
    );
  }

  // Host allow-listing, so a typo cannot point a live write run at whatever
  // resolves. Without an explicit staging host the wrapper accepts Vercel
  // preview hostnames only; a custom domain has to be named deliberately.
  const expectedHost = process.env.EVE_EVAL_STAGING_HOST?.trim();
  if (expectedHost) {
    if (url.hostname !== expectedHost) {
      throw new Error("The target host is not the configured staging host.");
    }
  } else if (!url.hostname.endsWith(".vercel.app")) {
    throw new Error(
      "Set EVE_EVAL_STAGING_HOST before using a non-Vercel staging hostname.",
    );
  }
  return url;
}

/** Exported for tests: the serial-writes rule must not be overridable. */
export function forwardedArgs(args: readonly string[], target: URL): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--url") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--url=")) continue;
    result.push(arg);
  }
  if (!result.includes("--strict")) result.push("--strict");
  if (!result.includes("--junit")) {
    result.push("--junit", ".eve/staging-junit.xml");
  }
  // Serial, always. Mutation cases share one staging database and one fixture
  // lead; two of them at once would race on the same records. An operator who
  // asks for more is told no rather than quietly overridden.
  if (!result.includes("--max-concurrency")) {
    result.push("--max-concurrency", "1");
  } else if (valueAfter(result, "--max-concurrency") !== "1") {
    throw new Error("Staging evals must run with --max-concurrency 1.");
  }
  result.push("--url", target.origin);
  return result;
}

async function responseJson(response: Response): Promise<BootstrapResponse> {
  if (!response.ok) {
    const hint =
      response.status === 404
        ? " The bootstrap route is disabled on this deployment (EVE_EVAL_AUTH_ENABLED, VERCEL_ENV=preview, EVE_EVAL_USER_ID)."
        : response.status === 401
          ? " EVE_EVAL_AUTH_SECRET does not match the deployment's."
          : "";
    throw new Error(
      `Staging evaluator authentication returned HTTP ${response.status}.${hint}`,
    );
  }
  try {
    return (await response.json()) as BootstrapResponse;
  } catch {
    throw new Error("Staging evaluator authentication returned invalid JSON.");
  }
}

async function mintToken(
  target: URL,
  secret: string,
): Promise<BootstrapResponse> {
  const response = await fetch(new URL("/api/eval/auth", target), {
    cache: "no-store",
    headers: { [EVAL_AUTH_HEADER]: secret },
    method: "POST",
  });
  const body = await responseJson(response);

  if (
    typeof body.token !== "string"
    || body.environment !== "preview"
    || typeof body.expiresInSeconds !== "number"
    || body.expiresInSeconds > EVAL_TOKEN_TTL_SECONDS
  ) {
    throw new Error(
      "The staging target did not return a short-lived evaluator token.",
    );
  }

  // Fail closed on a deployment where the agent is switched off, rather than
  // letting every case fail separately on `agent_disabled`.
  if (body.operationsAgentEnabled !== true) {
    throw new Error(
      "EVE_OPERATIONS_AGENT_ENABLED is not true on the staging target.",
    );
  }
  if (body.specialistsEnabled !== true) {
    throw new Error(
      "EVE_OPERATIONS_SPECIALISTS_ENABLED is not true on the staging target.",
    );
  }

  const expectedDatabase = process.env.EVE_EVAL_EXPECTED_DATABASE_LABEL?.trim();
  if (expectedDatabase && body.databaseLabel !== expectedDatabase) {
    throw new Error(
      `The staging target reports database "${String(body.databaseLabel)}", expected "${expectedDatabase}".`,
    );
  }
  const expectedFixtureVersion = process.env.EVE_EVAL_FIXTURE_VERSION?.trim();
  if (
    expectedFixtureVersion
    && body.fixtureVersion !== expectedFixtureVersion
  ) {
    throw new Error(
      `The staging target has fixture version "${String(body.fixtureVersion)}", expected "${expectedFixtureVersion}".`,
    );
  }
  return body;
}

async function verifyTarget(target: URL, token: string): Promise<void> {
  const response = await fetch(new URL("/eve/v1/info", target), {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(
      `The staging Eve info check returned HTTP ${response.status}.`,
    );
  }
  let body: { kind?: unknown; version?: unknown };
  try {
    body = (await response.json()) as { kind?: unknown; version?: unknown };
  } catch {
    throw new Error("The staging Eve info check returned invalid JSON.");
  }
  if (body.kind !== "eve-agent-info" || body.version !== 4) {
    throw new Error("The target is not the expected Eve v4 deployment.");
  }
}

async function revokeToken(
  target: URL,
  secret: string,
  token: string,
): Promise<void> {
  const sessionId = sessionIdFromJwt(token);
  if (!sessionId) return;
  await fetch(new URL("/api/eval/auth/revoke", target), {
    cache: "no-store",
    headers: {
      [EVAL_AUTH_HEADER]: secret,
      [EVAL_SESSION_HEADER]: sessionId,
    },
    method: "POST",
  });
}

export async function runStagingEval(args: readonly string[]): Promise<number> {
  const target = targetUrlFrom(args);
  const secret = process.env.EVE_EVAL_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "EVE_EVAL_AUTH_SECRET is required on the evaluator machine.",
    );
  }

  const bootstrap = await mintToken(target, secret);
  const token = bootstrap.token as string;
  await verifyTarget(target, token);

  console.error(
    `Running against ${target.origin} (deployment ${String(bootstrap.deployment)}, database ${String(bootstrap.databaseLabel)}, fixtures ${String(bootstrap.fixtureVersion)}).`,
  );

  const childArgs = ["exec", "eve", "eval", ...forwardedArgs(args, target)];
  const childEnv = { ...process.env, EVE_EVAL_AUTH_TOKEN: token };
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, childArgs, {
      env: childEnv,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  }).finally(async () => {
    await revokeToken(target, secret, token).catch(() => undefined);
  });
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runStagingEval(process.argv.slice(2));
  } catch (error) {
    process.exitCode = 1;
    console.error(
      error instanceof Error ? error.message : "Staging eval failed.",
    );
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}

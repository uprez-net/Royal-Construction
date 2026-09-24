import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

/**
 * The Eve channel refuses an anonymous caller.
 *
 * `/eve/v1/*` sits outside Clerk's middleware so the channel can return its
 * own structured authentication responses, which means this route is reachable
 * from the open internet and its own auth function is the only thing standing
 * in front of the whole tool catalogue. AGENTS.md is blunt about this class:
 * the shared-admin argument gives routes reachable without logging in no cover
 * at all.
 *
 * This case deliberately uses a bare `fetch` rather than `t.target.fetch`,
 * because the latter attaches the evaluator credential and would prove nothing.
 */
export default defineEval({
  description:
    "An unauthenticated request to the Eve session route is refused.",
  tags: ["read-only", "safety", "auth"],
  async test(t) {
    const response = await fetch(new URL("/eve/v1/session", t.target.url), {
      body: JSON.stringify({ message: "Who am I signed in as?" }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    t.check(
      response.status,
      satisfies(
        (status) => status === 401 || status === 403,
        `anonymous POST /eve/v1/session is refused; received ${response.status}`,
      ),
    ).label("anonymous session refused");

    // A refusal that leaks the reason is still a refusal, but a refusal that
    // returns a session id is not one. Read the body so a regression that
    // starts a session before authenticating cannot pass on the status alone.
    const body = await response.text();
    t.check(
      body,
      satisfies(
        (value) => typeof value === "string" && !/"sessionId"\s*:/.test(value),
        "the refusal does not hand back a session id",
      ),
    ).label("refusal carries no session");
  },
});

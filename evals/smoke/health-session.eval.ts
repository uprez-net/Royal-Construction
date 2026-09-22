import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { EVAL_FIXTURE_VERSION } from "../data/fixtures";

export default defineEval({
  description:
    "Create and complete an authenticated Eve session against the staging deployment.",
  tags: ["read-only", "smoke"],
  metadata: { fixtureVersion: EVAL_FIXTURE_VERSION },
  async test(t) {
    const turn = await t.send(
      "Confirm that this authenticated Royal Constructions operations session is ready. Reply with one short sentence.",
    );
    turn.expectOk();
    t.succeeded();

    // The session id is the whole point of this case: it proves the Clerk
    // token was accepted by agent/lib/channel-auth.ts, that the caller mapped
    // to an application User, and that a durable AgentSession row was created
    // and claimed by that owner. If any of those fail the channel answers 401
    // or 403 and there is no id to read.
    t.check(
      t.sessionId,
      satisfies(
        (value) => typeof value === "string" && value.length > 0,
        "the authenticated session was created and carries a durable id",
      ),
    ).label("session id present");
  },
});

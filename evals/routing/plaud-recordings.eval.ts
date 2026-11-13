import { defineEval } from "eve/evals";

/**
 * The other half of `agent/tools/connection_search.ts`: a Plaud question must
 * still reach connection discovery, or the office loses Plaud without a sign.
 *
 * The staging evaluator holds no Plaud grant, so discovery raises Plaud's
 * sign-in and the turn waits for it. That is expected here, and it is the
 * evidence the gate let the call through; an office user with a grant gets the
 * recordings instead. This is why the case does not use `expectRoutedTo`,
 * which fails on `authorization.required`.
 */
export default defineEval({
  description: "A Plaud recording question still reaches connection discovery.",
  tags: ["read-only", "routing", "plaud"],
  async test(t) {
    await t.send("List my Plaud recordings from this week.");
    t.calledTool("connection_search").label("Plaud discovery was offered");
  },
});

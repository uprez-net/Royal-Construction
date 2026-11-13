import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";
import { SPECIALISTS } from "../data/tools";

/**
 * What the suite is actually pointed at.
 *
 * Every other case reads or writes real staging records, so it matters that
 * the target is the deployment the operator meant and that it is composed the
 * way this suite assumes. `/eve/v1/info` is the contract that answers both,
 * and `t.target.fetch` carries the same evaluator credential the session
 * protocol uses — so a 401 here is the same 401 the rest of the run would hit,
 * reported once and legibly instead of thirty times.
 */
export default defineEval({
  description:
    "The target advertises the expected Eve agent contract and the six operations specialists.",
  tags: ["read-only", "smoke"],
  async test(t) {
    const response = await t.target.fetch("/eve/v1/info");
    await t.require(
      response.status,
      satisfies(
        (status) => status === 200,
        "GET /eve/v1/info is reachable and authenticated",
      ),
    );

    const info = (await response.json()) as {
      kind?: unknown;
      version?: unknown;
      agent?: { model?: { id?: unknown } };
      subagents?: { local?: readonly { name?: unknown }[] };
    };

    t.check(
      info,
      satisfies(
        () => info.kind === "eve-agent-info" && info.version === 5,
        "the target speaks the eve-agent-info v5 contract",
      ),
    ).label("info contract");

    const names = (info.subagents?.local ?? []).map((entry) =>
      String(entry.name),
    );
    const missing = SPECIALISTS.filter((name) => !names.includes(name));
    t.check(
      names,
      satisfies(
        () => missing.length === 0,
        `every operations specialist is composed; missing [${missing.join(", ")}], present [${names.join(", ")}]`,
      ),
    ).label("specialists composed");

    // Recorded rather than gated: the model is a deployment decision the
    // suite observes, not one it should block a run over. It lands in the
    // result metadata so a score change can be read against a model change.
    t.check(
      info.agent?.model?.id,
      satisfies(
        (value) => typeof value === "string" && value.length > 0,
        "the target reports the model it routes through",
      ),
    )
      .label("model reported")
      .soft();

    t.log(`target model: ${String(info.agent?.model?.id)}`);
  },
});

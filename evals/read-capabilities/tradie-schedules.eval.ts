import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";
import { observe } from "../helpers/tool-calls";

export default defineEval({
  description: "List the bookings held by one fixture tradie.",
  tags: ["read-only", "read-capabilities", "tradies"],
  async test(t) {
    const tradie = requireFixture(t, "scheduleTradie", fixtures.scheduleTradie);

    const turn = await t.send(
      `What is "${tradie}" booked on at the moment? List the bookings; do not change them.`,
    );
    t.succeeded();
    t.noFailedActions();
    const run = await observe(t, turn.session);
    assertNoMutation(t, run);

    expectEnvelopeFrom(t, run, "list_schedules", { kind: "schedule-list" });
  },
});

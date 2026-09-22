import { defineEval } from "eve/evals";
import { fixtures } from "../data/fixtures";
import { assertNoMutation } from "../helpers/boundaries";
import { expectEnvelopeFrom } from "../helpers/envelope";
import { requireFixture } from "../helpers/fixtures";

export default defineEval({
  description: "List the bookings held by one fixture tradie.",
  tags: ["read-only", "read-capabilities", "tradies"],
  async test(t) {
    const tradie = requireFixture(t, "scheduleTradie", fixtures.scheduleTradie);

    await t.send(
      `What is "${tradie}" booked on at the moment? List the bookings; do not change them.`,
    );
    t.succeeded();
    t.noFailedActions();
    assertNoMutation(t);

    expectEnvelopeFrom(t, t, "list_schedules", { kind: "schedule-list" });
  },
});

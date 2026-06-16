import assert from "node:assert/strict";
import { OFFER_GENERATION_MAX_STEPS } from "../../lib/agent/offerCreationAgent";

assert.equal(OFFER_GENERATION_MAX_STEPS, 8);
assert.ok(
  OFFER_GENERATION_MAX_STEPS <= 10,
  "Offer generation should keep Workflow event volume bounded.",
);

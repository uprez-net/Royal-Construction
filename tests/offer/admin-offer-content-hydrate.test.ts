import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mergeHydratedAdminContent,
  type AdminOfferContentState,
} from "../../lib/store/slices/admin-offer-content-hydrate";
import {
  EMPTY_ADMIN_OFFER_CONTENT,
  type AdminOfferContent,
} from "../../types/admin-offer-content";

// The admin offer page dispatched `hydrated(initialContent)` on every mount, and
// the reducer replaced the whole store and marked every section clean. The store
// outlives the page, so editing the cost schedule, visiting /leads and coming
// back silently dropped the edit and disabled Save. These rules pin the merge
// that replaced it.

const clean = {
  buildScope: false,
  costSchedule: false,
  offerScope: false,
  offerContent: false,
  hbfcClaim: false,
};
const noError = {
  buildScope: null,
  costSchedule: null,
  offerScope: null,
  offerContent: null,
  hbfcClaim: null,
};

const localEdit: AdminOfferContent["costSchedule"] = {
  rows: [
    {
      id: "row-1",
      taskKey: "slab",
      phase: "SLAB",
      task: "Slab",
      defaultInclude: true,
      priceMode: "fixed",
      value: 18_500,
    },
  ],
  rateConstants: { SLAB_COST_PER_SQM: 210 },
};

const state: AdminOfferContentState = {
  data: {
    ...structuredClone(EMPTY_ADMIN_OFFER_CONTENT),
    costSchedule: localEdit,
    offerScope: {
      allowances: [],
      exclusions: [
        {
          id: "ex-stale",
          name: "Stale exclusion",
          description: "",
          variationRule: "",
          exclusionKind: "excluded",
        },
      ],
    },
    version: 3,
  },
  dirty: { ...clean, costSchedule: true },
  saving: { ...clean },
  error: { ...noError, costSchedule: "Failed to save cost schedule." },
};

const payload: AdminOfferContent = {
  ...structuredClone(EMPTY_ADMIN_OFFER_CONTENT),
  costSchedule: { rows: [], rateConstants: {} },
  offerScope: {
    allowances: [],
    exclusions: [
      {
        id: "ex-server",
        name: "Pool fencing",
        description: "",
        variationRule: "",
        exclusionKind: "excluded",
      },
    ],
  },
  version: 7,
};

test("a dirty section keeps its unsaved data, its dirty flag and its error", () => {
  const merged = mergeHydratedAdminContent(state, payload);

  assert.deepEqual(merged.data.costSchedule, localEdit);
  assert.equal(merged.dirty.costSchedule, true);
  assert.equal(merged.error.costSchedule, "Failed to save cost schedule.");
});

test("a clean section takes the server copy and stays clean", () => {
  const merged = mergeHydratedAdminContent(state, payload);

  assert.deepEqual(merged.data.offerScope, payload.offerScope);
  assert.equal(merged.dirty.offerScope, false);
  assert.equal(merged.error.offerScope, null);
});

test("the version always comes from the server payload", () => {
  assert.equal(mergeHydratedAdminContent(state, payload).data.version, 7);
});

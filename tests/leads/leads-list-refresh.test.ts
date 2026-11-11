import assert from "node:assert/strict";
import { test } from "vitest";
import {
  reloadLeadList,
  updateAndRefreshLeadList,
  type LeadListView,
} from "@/components/leads/leads-list-refresh";
import type { LeadListParams } from "@/hooks/use-leads-data";

test("an edit waiting on stats refreshes the latest table page and sort", async () => {
  const requests: LeadListParams[] = [];
  const settled: number[] = [];
  let finishStats!: (updated: boolean) => void;
  const stats = new Promise<boolean>((resolve) => {
    finishStats = resolve;
  });
  let view: LeadListView = {
    activeTab: "table",
    tableParams: { page: 4, sort: "name-asc" },
    settleTablePage: () => assert.fail("settled the edit's old table view"),
  };
  const update = updateAndRefreshLeadList(
    () => stats,
    () => view,
    async (params) => {
      requests.push(params);
      return 2;
    },
  );
  view = {
    activeTab: "table",
    tableParams: { page: 3, sort: "name-desc", query: "smith" },
    settleTablePage: (page) => {
      if (page !== null) settled.push(page);
    },
  };
  finishStats(true);
  assert.equal(await update, true);
  assert.deepEqual(requests, [{ page: 3, sort: "name-desc", query: "smith" }]);
  assert.deepEqual(settled, [2]);
});

test("switching to Tasks during a stats refresh cannot replace its open-task cohort", async () => {
  const requests: LeadListParams[] = [];
  let finishStats!: (updated: boolean) => void;
  const stats = new Promise<boolean>((resolve) => {
    finishStats = resolve;
  });
  const view: LeadListView = {
    activeTab: "table",
    tableParams: { page: 4, sort: "name-desc" },
    settleTablePage: () => assert.fail("Tasks must not change the table URL"),
  };
  const update = updateAndRefreshLeadList(
    () => stats,
    () => view,
    async (params) => {
      requests.push(params);
      return 1;
    },
  );
  view.activeTab = "followups";
  finishStats(true);
  await update;
  assert.deepEqual(requests, [{ page: 1, limit: 50, hasOpenTask: true }]);
});

test("switching to Analytics during stats does not start another list request", async () => {
  const view: LeadListView = {
    activeTab: "table",
    tableParams: { page: 4 },
    settleTablePage: () => {},
  };
  await updateAndRefreshLeadList(
    async () => {
      view.activeTab = "analytics";
      return true;
    },
    () => view,
    async () => assert.fail("Analytics does not show lead rows"),
  );
});

test("adding a lead reloads Tasks from open-task page 1 and keeps table reloads scoped", async () => {
  for (const activeTab of ["followups", "table", "analytics"] as const) {
    const requests: LeadListParams[] = [];
    const settled: (number | null)[] = [];
    const tableParams: LeadListParams = {
      page: 4,
      sort: "name-desc",
      status: "Won",
    };
    await reloadLeadList(
      {
        activeTab,
        tableParams,
        settleTablePage: (page) => {
          settled.push(page);
        },
      },
      async (params) => {
        requests.push(params);
        return 3;
      },
    );
    assert.deepEqual(requests, [
      activeTab === "followups"
        ? { page: 1, limit: 50, hasOpenTask: true }
        : tableParams,
    ]);
    assert.deepEqual(settled, activeTab === "followups" ? [] : [3]);
  }
});

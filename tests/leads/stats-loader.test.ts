import assert from "node:assert/strict";
import { test } from "vitest";

import { createStatsLoader } from "@/lib/leads/stats-loader";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a load that names no timeframe reuses the last one (adding a lead from Tasks)", async () => {
  const asked: (string | undefined)[] = [];
  const loader = createStatsLoader(async (timing) => {
    asked.push(timing);
    return timing;
  });
  await loader.load("this_month");
  // reloadLeadList on the Tasks tab calls the full loader with no timeframe.
  await loader.load(undefined);
  await loader.load();
  assert.deepEqual(asked, ["this_month", "this_month", "this_month"]);
});

test("a named timeframe replaces the remembered one, including all time", async () => {
  const asked: (string | undefined)[] = [];
  const loader = createStatsLoader(async (timing) => {
    asked.push(timing);
    return timing;
  });
  await loader.load("this_month");
  await loader.load("all");
  await loader.load();
  assert.deepEqual(asked, ["this_month", "all", "all"]);
});

test("an older load that finishes after a newer one does not win", async () => {
  const older = deferred<string>();
  const newer = deferred<string>();
  const pending = [older, newer];
  const loader = createStatsLoader(() => pending.shift()!.promise);

  const first = loader.load("all"); // the full load, still waiting on its list
  const second = loader.load("today"); // the select changed meanwhile

  newer.resolve("today numbers");
  assert.equal(await second, "today numbers");
  older.resolve("all-time numbers");
  assert.equal(await first, null);
});

test("a failure rejects, and a later load still works", async () => {
  let fail = true;
  const loader = createStatsLoader(async () => {
    if (fail) throw new Error("boom");
    return "ok";
  });
  await assert.rejects(loader.load("today"), /boom/);
  fail = false;
  assert.equal(await loader.load(), "ok");
});

test("a failure of a superseded load is ignored; the newest load's failure is not", async () => {
  const older = deferred<string>();
  const newer = deferred<string>();
  const pending = [older, newer];
  const loader = createStatsLoader(() => pending.shift()!.promise);
  const rejections: string[] = [];
  const first = loader.load("all").catch((e) => {
    rejections.push(`first ${e.message}`);
    return "rejected";
  });
  const second = loader.load("today").catch((e) => {
    rejections.push(`second ${e.message}`);
    return "rejected";
  });
  newer.resolve("today numbers");
  assert.equal(await second, "today numbers");
  older.reject(new Error("old failure"));
  assert.equal(await first, null);
  assert.deepEqual(rejections, []);

  const only = createStatsLoader(async () => {
    throw new Error("latest failure");
  });
  await assert.rejects(only.load("today"), /latest failure/);
});

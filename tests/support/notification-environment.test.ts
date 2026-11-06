import assert from "node:assert/strict";
import { test } from "vitest";

import {
  PRODUCTION_MUTED_EMAILS,
  PRODUCTION_ORIGIN,
  STAGING_ORIGIN,
  notificationEnvironment,
  notificationSubscriberId,
  selectNotificationRecipients,
  serverNotificationOrigin,
} from "@/lib/notification/environment";

test("staging is told apart by APP_ENV even when Vercel calls it production", () => {
  assert.equal(
    notificationEnvironment({ APP_ENV: "staging", VERCEL_ENV: "production" }),
    "staging",
  );
  assert.equal(
    notificationEnvironment({ VERCEL_ENV: "production" }),
    "production",
  );
  assert.equal(
    notificationEnvironment({ VERCEL_ENV: "preview" }),
    "development",
  );
  assert.equal(notificationEnvironment({}), "development");
});

test("each deployment sends from its own origin", () => {
  assert.equal(
    serverNotificationOrigin({ VERCEL_ENV: "production" }),
    PRODUCTION_ORIGIN,
  );
  assert.equal(
    serverNotificationOrigin({ APP_ENV: "staging" }),
    STAGING_ORIGIN,
  );
  assert.equal(
    serverNotificationOrigin({
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "royal-git-feat.vercel.app",
    }),
    "https://royal-git-feat.vercel.app",
  );
  assert.equal(
    serverNotificationOrigin({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    "http://localhost:3000",
  );
});

test("production keeps the bare subscriber; every other origin has its own", () => {
  assert.equal(notificationSubscriberId("user_1", PRODUCTION_ORIGIN), "user_1");
  assert.equal(
    notificationSubscriberId("user_1", `${PRODUCTION_ORIGIN}/projects/x`),
    "user_1",
  );
  assert.equal(
    notificationSubscriberId("user_1", STAGING_ORIGIN),
    "royal-stage.vercel.app:user_1",
  );
  // The server and the browser on one machine agree whatever the port.
  assert.equal(
    notificationSubscriberId("user_1", "http://localhost:3000"),
    notificationSubscriberId("user_1", "http://localhost:3001"),
  );
  assert.notEqual(
    notificationSubscriberId("user_1", STAGING_ORIGIN),
    notificationSubscriberId("user_1", PRODUCTION_ORIGIN),
  );
});

const office = {
  clerkId: "c_office",
  email: "office@royalconstructions.com.au",
};
const dev = { clerkId: "c_dev", email: "Syed.Abdul@uprez.net" };

test("production never notifies the muted accounts, whatever their case", () => {
  assert.deepEqual(
    selectNotificationRecipients({
      environment: "production",
      recipients: [office, dev],
      requester: dev,
    }),
    [office],
  );
  assert.equal(PRODUCTION_MUTED_EMAILS.length, 5);
});

test("staging notifies only the person who made the request", () => {
  assert.deepEqual(
    selectNotificationRecipients({
      environment: "staging",
      recipients: [office],
      requester: dev,
    }),
    [dev],
  );
  // A cron or a webhook has nobody behind it, so staging stays quiet.
  assert.deepEqual(
    selectNotificationRecipients({
      environment: "staging",
      recipients: [office, dev],
      requester: null,
    }),
    [],
  );
});

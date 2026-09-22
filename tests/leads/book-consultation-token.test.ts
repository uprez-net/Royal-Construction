import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { test } from "vitest";

import {
  bookConsultationTokenSecret,
  signBookConsultationToken,
  verifyBookConsultationToken,
} from "@/lib/leads/book-consultation-token";

const SECRET = "x".repeat(40);

test("a signed token verifies for the same lead", () => {
  const token = signBookConsultationToken(42, SECRET);
  assert.ok(token);
  assert.equal(verifyBookConsultationToken(token!, 42, SECRET), true);
});

test("a token for another lead is rejected", () => {
  const token = signBookConsultationToken(42, SECRET);
  assert.equal(verifyBookConsultationToken(token!, 43, SECRET), false);
});

test("the public booking route does not trust a bare id", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  assert.ok(source.includes("resolveLeadClaim"));
  assert.ok(source.includes("verifyBookConsultationToken"));
  assert.ok(!source.includes("findLeadByEmail(id)"));
});

// ── Rejection cases the happy path cannot catch ──

test("a tampered signature is rejected", () => {
  const token = signBookConsultationToken(11, SECRET)!;
  const forged = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal(verifyBookConsultationToken(forged, 11, SECRET), false);
});

test("an expired token is rejected, and the expiry cannot be edited", () => {
  // The expiry is inside the MAC, so pushing it out invalidates the signature
  // rather than extending the token.
  const past = Math.floor(Date.now() / 1000) - 60;
  const payload = `11.${past}`;
  const mac = createHmac("sha256", SECRET).update(payload).digest("base64url");
  assert.equal(
    verifyBookConsultationToken(`${payload}.${mac}`, 11, SECRET),
    false,
  );

  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(
    verifyBookConsultationToken(`11.${future}.${mac}`, 11, SECRET),
    false,
    "the expiry was rewritten and the token still passed",
  );
});

test("no secret means no token, and nothing verifies", () => {
  // Fails CLOSED. An unset secret must never be read as "skip the check".
  assert.equal(signBookConsultationToken(11, null), null);
  const token = signBookConsultationToken(11, SECRET)!;
  assert.equal(verifyBookConsultationToken(token, 11, null), false);
});

test("a secret shorter than the minimum is treated as unset", () => {
  const weak = { BOOK_CONSULTATION_TOKEN_SECRET: "too-short" };
  assert.equal(bookConsultationTokenSecret(weak), null);
});

test("malformed tokens are rejected rather than throwing", () => {
  for (const bad of ["", ".", "11", "11.", "..", "11.abc.def", "garbage"]) {
    assert.equal(
      verifyBookConsultationToken(bad, 11, SECRET),
      false,
      `"${bad}" should not verify`,
    );
  }
});

// ── The route orders authorisation before its side effects ──

test("the booking route authorises before it touches the calendar", () => {
  // The gate used to run 37 lines AFTER the Graph event was created and the
  // invitation sent, so a caller naming a lead it could not prove lost only the
  // database write. The calendar entry and the email had already gone out.
  const source = readFileSync(
    join(process.cwd(), "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  const gate = source.indexOf("await resolveLeadClaim(");
  const graphEvent = source.indexOf("/events`");
  const leadWrite = source.indexOf("await upsertBookingNotes(");

  assert.ok(gate > 0, "the authorisation gate moved or was renamed");
  assert.ok(graphEvent > 0, "the Graph event call moved or was renamed");
  assert.ok(
    gate < graphEvent,
    "authorisation runs after the calendar event is created",
  );
  assert.ok(gate < leadWrite, "authorisation runs after the lead write");
});

test("an unprovable lead id is refused, not downgraded to anonymous", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/graph/book-consultant/route.ts"),
    "utf8",
  );
  assert.ok(
    /leadClaim\.kind === "unauthorized"[\s\S]{0,400}status: 403/.test(source),
    "a named-but-unproven lead no longer gets a 403",
  );
});

// ── The senders that have no Clerk session ──

test("automated welcome emails mint their own token", () => {
  // renderEmailHtml is a Server Action and authorises before it will mint, but
  // createLead and the inbound-lead workflow both run with no signed-in user:
  // the public booking route and the lead webhook call them. Left to authorise,
  // the token would be silently stripped and the client would be refused on the
  // booking link in their own welcome email — a 403, now that an unprovable
  // lead id is rejected rather than downgraded.
  for (const file of ["lib/data/leads.ts", "lib/workflow/lead-extraction.ts"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(
      source,
      /renderEmailHtml\(\s*"Welcome",[\s\S]{0,400}?signBookConsultationToken\(/,
      `${file} sends a welcome email with no booking token`,
    );
  }
});

test("a caller-supplied token is used as given, and is not a way to mint one", () => {
  const source = readFileSync(
    join(process.cwd(), "lib/leads/render-email-html.tsx"),
    "utf8",
  );
  // Supplied token wins; otherwise authorise, then mint. A caller can only pass
  // a token it already holds, so accepting one grants nothing it lacked.
  assert.match(
    source,
    /bookingToken \?\?[\s\S]{0,200}authorizeLeadAccess\(lead\.id\)\)\.ok[\s\S]{0,120}signBookConsultationToken\(lead\.id\)/,
    "the mint path no longer authorises first",
  );
});

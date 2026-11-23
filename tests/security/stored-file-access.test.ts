import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

// Project files used to be public Blob objects: anyone who had once held the
// link — a forwarded email, a browser history, a site manager who has since
// left — could read the HBCF certificate or the contract price with no account
// (#571). The store is private now, and a browser is handed a fifteen-minute,
// read-only link only after the same access rule as the page has run.

const issueSignedToken = vi.fn();
const presignUrl = vi.fn();

vi.mock("@/lib/blob", () => ({
  del: vi.fn(),
  get: vi.fn(),
  issueSignedToken: (...args: unknown[]) => issueSignedToken(...args),
  presignUrl: (...args: unknown[]) => presignUrl(...args),
  put: vi.fn(),
}));

import {
  isStoredBlobUrl,
  resetBlobDelegationsForTests,
  SIGNED_READ_TTL_MS,
  signBlobUrlsInHtml,
  signedBlobReadUrl,
} from "@/lib/blob-port";
import {
  isBlobStorageUrl,
  isBlobStoreUrl,
  isPrivateBlobUrl,
  parseBlobUrl,
} from "@/lib/blob-url";
import { DomainNotFoundError } from "@/lib/domain/errors";
import { authorizeStoredFileRead } from "@/lib/domain/files";
import { fileHref, storedImageProps } from "@/lib/files/file-href";
import {
  adminPrincipal,
  customerPrincipal,
  recordingDb,
  siteManagerPrincipal,
} from "../architecture/domain-harness";

const STORE = "newstore123";
const PRIVATE = `https://${STORE}.private.blob.vercel-storage.com`;
const PUBLIC = "https://oldstore456.public.blob.vercel-storage.com";
const TOKEN = `vercel_blob_rw_${STORE}_secret`;

describe("recognising stored URLs", () => {
  test("both access modes are Blob, and the store is pinned either way", () => {
    assert.deepEqual(parseBlobUrl(`${PRIVATE}/projects/p1/a%20b.pdf`), {
      access: "private",
      pathname: "projects/p1/a b.pdf",
      storeId: STORE,
    });
    assert.equal(isBlobStorageUrl(`${PUBLIC}/x.pdf`), true);
    assert.equal(isPrivateBlobUrl(`${PUBLIC}/x.pdf`), false);
    assert.equal(isPrivateBlobUrl(`${PRIVATE}/x.pdf`), true);
    assert.equal(isBlobStoreUrl(`${PRIVATE}/x.pdf`, STORE), true);
    assert.equal(isBlobStoreUrl(`${PRIVATE}/x.pdf`, "someoneelse"), false);
    assert.equal(isBlobStoreUrl(`${PRIVATE}/x.pdf`, null), false);
  });

  test("lookalikes are not Blob", () => {
    for (const url of [
      `http://${STORE}.private.blob.vercel-storage.com/x.pdf`,
      "https://evil.example/x.private.blob.vercel-storage.com/a.pdf",
      "https://private.blob.vercel-storage.com.evil.example/a.pdf",
      `https://user:pass@${STORE}.private.blob.vercel-storage.com/a.pdf`,
      `${PRIVATE}/`,
      "/api/files/signed-url?url=x",
      "",
    ]) {
      assert.equal(isBlobStorageUrl(url), false, url);
    }
  });
});

describe("fileHref", () => {
  test("a private file goes through the signing route, anything else is left alone", () => {
    const url = `${PRIVATE}/projects/p1/tender.pdf`;
    const href = fileHref(url);
    assert.equal(
      href,
      `/api/files/signed-url?redirect=1&url=${encodeURIComponent(url)}`,
    );
    assert.equal(
      new URLSearchParams(href.split("?")[1]).get("url"),
      url,
      "the stored URL survives the round trip",
    );
    assert.equal(fileHref(`${PUBLIC}/x.pdf`), `${PUBLIC}/x.pdf`);
    assert.equal(fileHref("https://example.com/x"), "https://example.com/x");
    assert.equal(fileHref(null), undefined);
    assert.equal(fileHref(""), "");
  });

  test("a private image skips the optimiser, which has no session", () => {
    assert.equal(storedImageProps(`${PRIVATE}/a.png`).unoptimized, true);
    assert.deepEqual(storedImageProps(`${PUBLIC}/a.png`), {
      src: `${PUBLIC}/a.png`,
      unoptimized: false,
    });
  });
});

describe("authorizeStoredFileRead", () => {
  const url = `${PRIVATE}/projects/p1/file.pdf`;

  const file = (overrides: Record<string, unknown> = {}) => ({
    complianceDocument: null,
    filename: "site-photo.jpg",
    id: "f1",
    leadId: null,
    project: {
      Lead: null,
      customerId: "c1",
      requirements: {},
      siteManagerId: "user_site_manager",
    },
    tags: [],
    uploadedBy: "user_other",
    url,
    ...overrides,
  });

  test("the office opens any stored file without a lookup", async () => {
    const recorder = recordingDb();
    await authorizeStoredFileRead(adminPrincipal(), url, recorder.db);
    assert.equal(recorder.calls.length, 0);
  });

  test("a customer opens a milestone photo on their own project, and nothing else", async () => {
    const customer = {
      customerId: "c1",
      kind: "user",
      role: "CUSTOMER",
      userId: "user_customer",
    } as const;
    const recorder = recordingDb({ "file.findFirst": { id: "f1" } });
    await authorizeStoredFileRead(customer, url, recorder.db);
    // The entitlement comes from the milestone's project, and only photos.
    const [query] = recorder.calls.map((call) => call.args) as {
      where: Record<string, unknown>;
    }[];
    assert.deepEqual(query!.where.milestone, {
      project: { customerId: "c1" },
    });
    assert.deepEqual(query!.where.fileType, { startsWith: "image/" });
    assert.equal(query!.where.leadId, null);
    assert.equal(query!.where.url, url);

    // Not one of theirs (another job's photo, a document, a lead's file).
    await assert.rejects(
      () =>
        authorizeStoredFileRead(
          customer,
          url,
          recordingDb({ "file.findFirst": null }).db,
        ),
      DomainNotFoundError,
    );
    // A portal account never linked to a customer opens nothing, unasked.
    const unlinked = recordingDb();
    await assert.rejects(
      () =>
        authorizeStoredFileRead(
          { ...customer, customerId: null },
          url,
          unlinked.db,
        ),
      DomainNotFoundError,
    );
    assert.equal(unlinked.calls.length, 0);
  });

  test("a customer with no link, a guest or nobody is never handed a link", async () => {
    for (const principal of [
      customerPrincipal(),
      { kind: "user", role: "GUEST", userId: "g" } as const,
      { kind: "anonymous", source: "test" } as const,
    ]) {
      await assert.rejects(
        () => authorizeStoredFileRead(principal, url, recordingDb().db),
        DomainNotFoundError,
      );
    }
  });

  test("a site manager opens a file on their project", async () => {
    await authorizeStoredFileRead(
      siteManagerPrincipal(),
      url,
      recordingDb({ "file.findMany": [file()] }).db,
    );
  });

  test("a site manager is refused the tender, and it is not looked up elsewhere", async () => {
    const recorder = recordingDb({
      "file.findMany": [file({ filename: "Tender.pdf", tags: ["Tender"] })],
    });
    await assert.rejects(
      () => authorizeStoredFileRead(siteManagerPrincipal(), url, recorder.db),
      DomainNotFoundError,
    );
    assert.deepEqual(
      recorder.calls.map((call) => call.operation),
      ["file.findMany"],
    );
  });

  test("a site manager is refused a lead's file", async () => {
    await assert.rejects(
      () =>
        authorizeStoredFileRead(
          siteManagerPrincipal(),
          url,
          recordingDb({ "file.findMany": [file({ leadId: 7 })] }).db,
        ).then(() => undefined),
      DomainNotFoundError,
    );
  });

  test("a site manager opens a site-update photo or project-group media", async () => {
    for (const [siteUpdate, media] of [
      [{ id: "u1" }, null],
      [null, { id: "m1" }],
    ]) {
      await authorizeStoredFileRead(
        siteManagerPrincipal(),
        url,
        recordingDb({
          "file.findMany": [],
          "siteUpdate.findFirst": siteUpdate,
          "whatsAppMedia.findFirst": media,
        }).db,
      );
    }
  });

  test("anything else stored is the office's", async () => {
    await assert.rejects(
      () =>
        authorizeStoredFileRead(
          siteManagerPrincipal(),
          url,
          recordingDb({
            "file.findMany": [],
            "siteUpdate.findFirst": null,
            "whatsAppMedia.findFirst": null,
          }).db,
        ),
      DomainNotFoundError,
    );
  });
});

describe("signing", () => {
  const env = process.env as Record<string, string | undefined>;
  const before = {
    main: env.BLOB_READ_WRITE_TOKEN,
    recordings: env.BLOB_PRIVATE_READ_WRITE_TOKEN,
  };

  beforeEach(() => {
    env.BLOB_READ_WRITE_TOKEN = TOKEN;
    delete env.BLOB_PRIVATE_READ_WRITE_TOKEN;
    resetBlobDelegationsForTests();
    issueSignedToken.mockReset();
    presignUrl.mockReset();
    issueSignedToken.mockImplementation(
      async (options: { validUntil: number }) => ({
        clientSigningToken: "client-signing",
        delegationToken: "delegation",
        validUntil: options.validUntil,
      }),
    );
    presignUrl.mockImplementation(
      async (_token: unknown, options: { pathname: string }) => ({
        presignedUrl: `${PRIVATE}/${options.pathname}?vercel-blob-signature=sig&x=1`,
      }),
    );
  });

  afterEach(() => {
    for (const [key, value] of [
      ["BLOB_READ_WRITE_TOKEN", before.main],
      ["BLOB_PRIVATE_READ_WRITE_TOKEN", before.recordings],
    ] as const) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  });

  test("a private file gets a get-only link that lasts fifteen minutes", async () => {
    const start = Date.now();
    const signed = await signedBlobReadUrl(`${PRIVATE}/projects/a%20b.pdf`);
    assert.match(signed.url, /vercel-blob-signature=sig/);
    assert.ok(signed.expiresAt !== null);
    assert.ok(signed.expiresAt - start <= SIGNED_READ_TTL_MS + 1_000);
    assert.ok(signed.expiresAt - start >= SIGNED_READ_TTL_MS - 1_000);

    const [delegation] = issueSignedToken.mock.calls[0]!;
    assert.deepEqual(delegation.operations, ["get"]);
    assert.equal(delegation.token, TOKEN);
    const [, presign] = presignUrl.mock.calls[0]!;
    assert.equal(presign.operation, "get");
    assert.equal(presign.access, "private");
    assert.equal(presign.pathname, "projects/a b.pdf");
  });

  test("one delegation serves many links", async () => {
    await Promise.all(
      ["a", "b", "c"].map((name) =>
        signedBlobReadUrl(`${PRIVATE}/${name}.jpg`),
      ),
    );
    await signedBlobReadUrl(`${PRIVATE}/d.jpg`);
    assert.equal(issueSignedToken.mock.calls.length, 1);
    assert.equal(presignUrl.mock.calls.length, 4);
  });

  test("a public or non-Blob URL is answered as it is", async () => {
    for (const url of [`${PUBLIC}/x.pdf`, "https://example.com/x.pdf"]) {
      assert.deepEqual(await signedBlobReadUrl(url), { expiresAt: null, url });
    }
    assert.equal(issueSignedToken.mock.calls.length, 0);
  });

  test("a stranger's private store is not ours to sign or hand out", async () => {
    const foreign = "https://stranger.private.blob.vercel-storage.com/x.pdf";
    await assert.rejects(() => signedBlobReadUrl(foreign));
    assert.equal(isStoredBlobUrl(foreign), false);
    assert.equal(isStoredBlobUrl(`${PRIVATE}/x.pdf`), true);
    assert.equal(isStoredBlobUrl(`${PUBLIC}/x.pdf`), true);
    assert.equal(isStoredBlobUrl("https://example.com/x.pdf"), false);
  });

  test("a rendered document has its private images signed, attribute-safe", async () => {
    const html = `<img src="${PRIVATE}/offer/hero.png"><div style="background:url(${PRIVATE}/offer/bg.png)"></div><img src="${PUBLIC}/old.png">`;
    const signed = await signBlobUrlsInHtml(html);
    assert.ok(
      signed.includes(
        `src="${PRIVATE}/offer/hero.png?vercel-blob-signature=sig&amp;x=1"`,
      ),
    );
    assert.ok(
      signed.includes(
        `url(${PRIVATE}/offer/bg.png?vercel-blob-signature=sig&amp;x=1)`,
      ),
    );
    assert.ok(signed.includes(`src="${PUBLIC}/old.png"`));
  });

  test("a pathname with parentheses is signed whole, inside a tag or url()", async () => {
    const html = `<img src="${PRIVATE}/site(1).jpg"><div style="background-image:url(${PRIVATE}/photos/site(2).jpg);"></div>`;
    const signed = await signBlobUrlsInHtml(html);
    const pathnames = presignUrl.mock.calls.map(
      ([, options]) => options.pathname,
    );
    assert.deepEqual(pathnames.sort(), ["photos/site(2).jpg", "site(1).jpg"]);
    assert.ok(
      signed.includes(
        `src="${PRIVATE}/site(1).jpg?vercel-blob-signature=sig&amp;x=1"`,
      ),
    );
    assert.ok(
      signed.includes(
        `url(${PRIVATE}/photos/site(2).jpg?vercel-blob-signature=sig&amp;x=1);`,
      ),
      "the url() closing parenthesis stays outside the signed link",
    );
  });

  test("an image that cannot be signed fails the render instead of leaving a hole", async () => {
    presignUrl.mockRejectedValueOnce(new Error("store unreachable"));
    await assert.rejects(
      () =>
        signBlobUrlsInHtml(
          `<img src="${PRIVATE}/a.png"><img src="${PRIVATE}/b.png">`,
        ),
      /1 of 2 stored image\(s\)/,
    );
  });
});

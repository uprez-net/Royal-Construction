import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";

// The address pickers cannot tell "no such address" from "the lookup broke"
// unless the route answers a failure with a failure. These pin the four ways
// the lookup can end, and that each failure leaves a server-side log line (the
// pickers' only other signal is a console.error in the browser).

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

const { GET } = await import("@/app/api/address/route");

const keys = {
  google: process.env.GOOGLE_MAPS_API_KEY,
  geoscape: process.env.GEOSCAPE_API_KEY,
};
const errors = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = "google-test";
  process.env.GEOSCAPE_API_KEY = "geoscape-test";
});
afterEach(() => {
  for (const [name, value] of [
    ["GOOGLE_MAPS_API_KEY", keys.google],
    ["GEOSCAPE_API_KEY", keys.geoscape],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
  errors.mockClear();
});

const ask = () =>
  GET(new Request("http://localhost/api/address?query=12%20smith"));

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal("fetch", async (input: string | URL) => handler(String(input)));
}

const prediction = {
  placePrediction: { placeId: "p1", text: { text: "12 Smith St" } },
};
const details = {
  formattedAddress: "12 Smith St, Sydney NSW 2000",
  location: { latitude: -33.8, longitude: 151.2 },
  addressComponents: [
    { longText: "2000", shortText: "2000", types: ["postal_code"] },
  ],
};

test("a missing key is a 500 that is logged, not a silent one", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "";
  const response = await ask();
  assert.equal(response.status, 500);
  assert.equal(errors.mock.calls.length, 1);
});

test("a provider refusal is passed on as a failure and logged", async () => {
  stubFetch(() => new Response("denied", { status: 403 }));
  const response = await ask();
  assert.equal(response.status, 403);
  assert.equal(errors.mock.calls.length, 1);
});

test("suggestions whose details all fail are a 502, not an empty 200", async () => {
  stubFetch((url) =>
    url.includes("places:autocomplete")
      ? Response.json({ suggestions: [prediction] })
      : new Response("denied", { status: 403 }),
  );
  const response = await ask();
  assert.equal(response.status, 502);
  assert.equal(errors.mock.calls.length, 1);
});

test("no predictions is a genuine empty result", async () => {
  stubFetch(() => Response.json({}));
  const response = await ask();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data.suggestions, []);
  assert.equal(errors.mock.calls.length, 0);
});

test("a found address comes back as a suggestion", async () => {
  stubFetch((url) => {
    if (url.includes("places:autocomplete")) {
      return Response.json({ suggestions: [prediction] });
    }
    if (url.includes("places.googleapis.com/v1/places/"))
      return Response.json(details);
    return Response.json({
      features: [{ properties: { lgaName: "City of Sydney", state: "NSW" } }],
    });
  });
  const response = await ask();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.suggestions[0].address, details.formattedAddress);
  assert.equal(body.data.suggestions[0].council, "City of Sydney");
});

import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";

const reported = vi.hoisted(() => ({
  calls: [] as Array<{ service: string; operation: string; error: unknown }>,
}));
vi.mock("@/lib/observability/external", () => ({
  reportExternalError: (service: string, operation: string, error: unknown) => {
    reported.calls.push({ service, operation, error });
  },
}));

import { instrumentDocusignApiClient } from "@/lib/docusign/instrument";

beforeEach(() => {
  reported.calls.length = 0;
});

const ENVELOPES = "/v2.1/accounts/{accountId}/envelopes";

function client(callApi: (...args: never[]) => unknown) {
  return { callApi, label: "client" };
}

describe("instrumentDocusignApiClient — every DocuSign call ends in callApi", () => {
  test("a failed call is reported under the route template, not the URL", async () => {
    // Axios' error shape: the status is on `response`.
    const failure = Object.assign(new Error("Request failed"), {
      response: { status: 503, data: { errorCode: "X" } },
    });
    const api = instrumentDocusignApiClient(
      client((async () => {
        throw failure;
      }) as never),
    );

    const caught = await (
      api.callApi as unknown as (...a: unknown[]) => Promise<unknown>
    )(ENVELOPES, "post", { accountId: "acc-123" }).catch((e: unknown) => e);

    assert.equal(caught, failure, "the caller gets the SDK's own rejection");
    assert.equal(reported.calls.length, 1);
    assert.equal(reported.calls[0].service, "docusign");
    // No account id, no envelope id, and the method is normalised.
    assert.equal(reported.calls[0].operation, `POST ${ENVELOPES}`);
  });

  test("a successful call resolves untouched and reports nothing", async () => {
    const api = instrumentDocusignApiClient(
      client((async () => ({ envelopeId: "e1" })) as never),
    );
    const result = await (
      api.callApi as unknown as (...a: unknown[]) => Promise<unknown>
    )(ENVELOPES, "get");
    assert.deepEqual(result, { envelopeId: "e1" });
    assert.equal(reported.calls.length, 0);
  });

  test("the callback form is left alone: nothing to watch, nothing broken", () => {
    const api = instrumentDocusignApiClient(client((() => undefined) as never));
    assert.equal(
      (api.callApi as unknown as (...a: unknown[]) => unknown)(
        ENVELOPES,
        "get",
      ),
      undefined,
    );
    assert.equal(reported.calls.length, 0);
  });

  test("it returns the same client, with its other members intact", () => {
    const original = client((async () => undefined) as never);
    const api = instrumentDocusignApiClient(original);
    assert.equal(api, original);
    assert.equal(api.label, "client");
  });

  test("`this` still reaches the SDK: the original is bound to the client", async () => {
    const self = {
      base: "https://demo.docusign.net",
      callApi(this: { base: string }) {
        return Promise.resolve(this.base);
      },
    };
    const api = instrumentDocusignApiClient(self);
    assert.equal(
      await (api.callApi as unknown as (...a: unknown[]) => Promise<string>)(
        ENVELOPES,
        "get",
      ),
      "https://demo.docusign.net",
    );
  });
});

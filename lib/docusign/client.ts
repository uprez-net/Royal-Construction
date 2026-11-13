import docusign from "docusign-esign";
import { reportExternalError } from "@/lib/observability/external";
import type { DocusignConfig } from "./config";
import { instrumentDocusignApiClient } from "./instrument";

export interface DocusignContext {
  readonly apiClient: docusign.ApiClient;
  readonly accountId: string;
}

// JWT access tokens last an hour; cache the authenticated client and renew a
// couple of minutes early so concurrent sends don't re-authenticate.
let cached: { context: DocusignContext; expiresAt: number } | null = null;

export async function createDocusignContext(
  config: DocusignConfig,
): Promise<DocusignContext> {
  if (cached && Date.now() < cached.expiresAt) {
    return cached.context;
  }

  const apiClient = instrumentDocusignApiClient(new docusign.ApiClient());
  apiClient.setBasePath(config.basePath);
  apiClient.setOAuthBasePath(config.oauthBasePath);

  let result;
  try {
    result = await apiClient.requestJWTUserToken(
      config.integrationKey,
      config.userId,
      ["signature", "impersonation"],
      Buffer.from(config.privateKey),
      3600,
    );
  } catch (error) {
    // The JWT grant IS our credential. DocuSign answers a revoked consent or a
    // rotated key with a 400 (`consent_required`), so any failure counts: with
    // no token every envelope send stops until someone grants consent again.
    reportExternalError("docusign", "requestJWTUserToken", error, {
      force: true,
    });
    throw error;
  }
  const body = result.body as {
    access_token: string;
    expires_in?: number;
  };
  apiClient.addDefaultHeader("Authorization", `Bearer ${body.access_token}`);

  const context: DocusignContext = { apiClient, accountId: config.accountId };
  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  cached = { context, expiresAt: Date.now() + lifetimeMs - 120_000 };
  return context;
}

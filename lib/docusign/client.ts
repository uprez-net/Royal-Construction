import docusign from "docusign-esign";
import type { DocusignConfig } from "./config";

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

  const apiClient = new docusign.ApiClient();
  apiClient.setBasePath(config.basePath);
  apiClient.setOAuthBasePath(config.oauthBasePath);

  const result = await apiClient.requestJWTUserToken(
    config.integrationKey,
    config.userId,
    ["signature", "impersonation"],
    Buffer.from(config.privateKey),
    3600,
  );
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

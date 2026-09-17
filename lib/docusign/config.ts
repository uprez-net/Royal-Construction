// DocuSign JWT-grant configuration (ADR 0001). The integration key must have
// the "signature" + "impersonation" scopes consented for the impersonated
// user (one-time consent URL: <oauth base>/oauth/auth?response_type=code&
// scope=signature%20impersonation&client_id=<key>&redirect_uri=<redirect>).
export interface DocusignConfig {
  readonly integrationKey: string;
  readonly userId: string;
  readonly accountId: string;
  readonly privateKey: string;
  readonly oauthBasePath: string;
  readonly basePath: string;
  readonly builderSignerName: string;
  readonly builderSignerEmail: string;
  readonly connectWebhookUrl: string | null;
  // MBA BC4 contract template (see lib/docusign/contract-template-spec.md);
  // null until the template is created in the DocuSign account.
  readonly contractTemplateId: string | null;
  readonly contractDefaultTemplateId: string | null;
  readonly contractMultipleOwnersTemplateId: string | null;
}

export function getDocusignConfig(): DocusignConfig {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const rawPrivateKey = process.env.DOCUSIGN_PRIVATE_KEY;
  const builderSignerName = process.env.DOCUSIGN_BUILDER_SIGNER_NAME;
  const builderSignerEmail = process.env.DOCUSIGN_BUILDER_SIGNER_EMAIL;

  const missing = [
    ["DOCUSIGN_INTEGRATION_KEY", integrationKey],
    ["DOCUSIGN_USER_ID", userId],
    ["DOCUSIGN_ACCOUNT_ID", accountId],
    ["DOCUSIGN_PRIVATE_KEY", rawPrivateKey],
    ["DOCUSIGN_BUILDER_SIGNER_NAME", builderSignerName],
    ["DOCUSIGN_BUILDER_SIGNER_EMAIL", builderSignerEmail],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `DocuSign is not configured — missing env: ${missing.join(", ")}`,
    );
  }

  return {
    integrationKey: integrationKey as string,
    userId: userId as string,
    accountId: accountId as string,
    privateKey: normalizePrivateKey(rawPrivateKey as string),
    // Defaults target the developer sandbox; production uses
    // account.docusign.com + the account's own base URI.
    oauthBasePath:
      process.env.DOCUSIGN_OAUTH_BASE_PATH ?? "account-d.docusign.com",
    basePath:
      process.env.DOCUSIGN_BASE_PATH ?? "https://demo.docusign.net/restapi",
    builderSignerName: builderSignerName as string,
    builderSignerEmail: builderSignerEmail as string,
    connectWebhookUrl: process.env.DOCUSIGN_CONNECT_WEBHOOK_URL ?? null,
    contractTemplateId: process.env.DOCUSIGN_CONTRACT_TEMPLATE_ID ?? null,
    contractDefaultTemplateId:
      process.env.DOCUSIGN_CONTRACT__DEFAULT_TEMPLATE_ID ?? null,
    contractMultipleOwnersTemplateId:
      process.env.DOCUSIGN_CONTRACT__MULTIPLE_TEMPLATE_ID ?? null,
  };
}

// Accepts the RSA key as-is, with "\n" escapes (single-line env var), or
// base64-encoded (no PEM header) — whichever is easiest to store.
function normalizePrivateKey(raw: string): string {
  const unescaped = raw.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("-----BEGIN")) {
    return unescaped;
  }
  return Buffer.from(unescaped, "base64").toString("utf8");
}

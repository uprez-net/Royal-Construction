namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: "development" | "production" | "test";

    // Database
    DATABASE_URL: string;

    // Clerk Auth
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: string;
    CLERK_SECRET_KEY: string;
    CLERK_WEBHOOK_SIGNING_SECRET: string;
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: string;
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: string;

    // Vercel Blob
    BLOB_READ_WRITE_TOKEN: string;

    // APIs
    GOOGLE_MAPS_API_KEY: string;
    GEOSCAPE_API_KEY: string;
    GEMINI_API_KEY: string;

    // Azure / Microsoft Graph
    AZURE_TENANT_ID: string;
    AZURE_CLIENT_ID: string;
    AZURE_CLIENT_SECRET: string;

    GRAPH_MODE: "delegated" | "app-only";

    BUSINESS_EMAIL: string;
    BUSINESS_ADMIN_EMAIL: string;
    // Server-only. There is deliberately no NEXT_PUBLIC_ counterpart:
    // Next inlines NEXT_PUBLIC_* into the browser bundle wherever it is
    // referenced, so declaring one here invites shipping this token to
    // every visitor. The Graph admin routes are server-side only.
    GRAPH_ADMIN_TOKEN: string;
    GRAPH_SENDER_UPN: string;
    GRAPH_ADMIN_SENDER_UPN: string;
    MAIL_ID_CC: string;
    GRAPH_ADMIN_MAIL_CC: string;

    // Demo Mail Config
    DEMO_RECIPIENT: string;
    DEMO_SUBJECT: string;
    DEMO_BODY: string;

    // Webhook Config
    WEBHOOK_PORT: string;
    WEBHOOK_PATH: string;
    GRAPH_WEBHOOK_CLIENT_STATE: string;
    GRAPH_ADMIN_WEBHOOK_CLIENT_STATE: string;
    GRAPH_NOTIFICATION_URL: string;
    GRAPH_SUBSCRIPTION_EXPIRATION_MINUTES: string;
    GRAPH_SUBSCRIPTION_RESOURCE: string;
    GRAPH_ADMIN_SUBSCRIPTION_RESOURCE: string;

    // App
    NEXT_PUBLIC_APP_URL: string;

    // Novu
    NOVU_SECRET_KEY: string;
    NEXT_PUBLIC_NOVU_APP_IDENTIFIER: string;

    // Mistral AI
    MISTRAL_AI_KEY: string;

    // AI Gateway
    AI_GATEWAY_API_KEY: string;

    // Scrapedo (Web Scraping)
    SCRAPEDO_TOKEN: string;

    // Xero. The connection uses the authorization-code grant, so the
    // tenant and tokens are discovered at consent and held in
    // XeroConnection rather than configured here.
    XERO_CLIENT_ID: string;
    XERO_CLIENT_SECRET: string;
    // Must match a redirect URI registered on the Xero app byte for byte.
    // Falls back to `${NEXT_PUBLIC_APP_URL}/api/xero/connect` when unset.
    XERO_REDIRECT_URI: string;
    // Signs every webhook delivery; without it /api/xero/notification
    // rejects everything, which is also what Xero's Intent To Receive
    // check expects of an unconfigured endpoint.
    XERO_WEBHOOK_SECRET: string;
    // The revenue account in the Xero chart of accounts that progress
    // claims post to, e.g. "200" in the stock AU chart. Required to raise
    // a claim: Xero will not approve an invoice without one. Not defaulted
    // — organisations renumber accounts, and a guess posts real revenue to
    // whatever sits at that code.
    XERO_SALES_ACCOUNT_CODE: string;
    // Optional override, e.g. "OUTPUT" for GST on Income. Left unset, Xero
    // applies the sales account's own default tax rate.
    XERO_SALES_TAX_TYPE: string;

    // Eve Operations
    EVE_OPERATIONS_AGENT_ENABLED: string;
    EVE_OPERATIONS_SPECIALISTS_ENABLED: string;

    // Upstash Redis
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;

    TEST_USER_EMAIL: string;
  }
}

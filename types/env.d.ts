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
        GRAPH_ADMIN_TOKEN: string;
        NEXT_PUBLIC_GRAPH_ADMIN_TOKEN: string;
        GRAPH_SENDER_UPN: string;

        // Demo Mail Config
        DEMO_RECIPIENT: string;
        DEMO_SUBJECT: string;
        DEMO_BODY: string;

        // Webhook Config
        WEBHOOK_PORT: string;
        WEBHOOK_PATH: string;
        GRAPH_WEBHOOK_CLIENT_STATE: string;
        GRAPH_NOTIFICATION_URL: string;
        GRAPH_SUBSCRIPTION_EXPIRATION_MINUTES: string;
        GRAPH_SUBSCRIPTION_RESOURCE: string;

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
    }
}
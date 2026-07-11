import { XeroClient } from "xero-node";

const {
  XERO_CLIENT_ID,
  XERO_CLIENT_SECRET,
  XERO_TENANT_ID,
} = process.env;

if (!XERO_CLIENT_ID) {
  throw new Error("XERO_CLIENT_ID is not defined.");
}

if (!XERO_CLIENT_SECRET) {
  throw new Error("XERO_CLIENT_SECRET is not defined.");
}

if (!XERO_TENANT_ID) {
  throw new Error("XERO_TENANT_ID is not defined.");
}

const globalForXero = globalThis as typeof globalThis & {
  xero?: XeroClient;
};

export const xero =
  globalForXero.xero ??
  new XeroClient({
    clientId: XERO_CLIENT_ID,
    clientSecret: XERO_CLIENT_SECRET,
    grantType: "client_credentials",
  });

if (process.env.NODE_ENV !== "production") {
  globalForXero.xero = xero;
}

export const xeroTenantId = XERO_TENANT_ID;
import { XeroClient } from 'xero-node';

const globalForXero = globalThis as unknown as { xero?: XeroClient };

const xeroClient = globalForXero.xero ?? new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  grantType: 'client_credentials',
});

const xeroTenantId = process.env.XERO_TENANT_ID;

if (!xeroTenantId) {
    throw new Error('XERO_TENANT_ID is not defined in the environment variables.');
}

export { xeroClient as xero, xeroTenantId };
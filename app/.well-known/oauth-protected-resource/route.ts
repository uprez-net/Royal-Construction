import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from 'mcp-handler';
 
const handler = protectedResourceHandler({
  authServerUrls: ['https://present-grackle-89.clerk.accounts.dev'],
});
 
const corsHandler = metadataCorsOptionsRequestHandler();
 
export { handler as GET, corsHandler as OPTIONS };
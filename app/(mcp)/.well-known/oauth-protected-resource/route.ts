import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from '@clerk/mcp-tools/next'

const handler = protectedResourceHandlerClerk({
  // Specify which OAuth scopes this protected resource supports
  scopes_supported: ['profile', 'email'],
})

const corsOptionsHandler = metadataCorsOptionsRequestHandler()

export { handler as GET, corsOptionsHandler as OPTIONS }
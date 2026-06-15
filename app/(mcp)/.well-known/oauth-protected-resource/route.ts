import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from '@clerk/mcp-tools/next'

const handler = protectedResourceHandlerClerk({
  // Specify which OAuth scopes this protected resource supports
  scopes_supported: ['profile', 'email'],
  resource: `${process.env.NEXT_PUBLIC_APP_URL}/mcp`,
})

export { handler as GET }

export function OPTIONS(_: Request): Response | Promise<Response> {
  const preflightHandler = metadataCorsOptionsRequestHandler();
  return preflightHandler();
}
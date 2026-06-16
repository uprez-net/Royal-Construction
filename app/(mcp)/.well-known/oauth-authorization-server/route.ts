import {
  authServerMetadataHandlerClerk,
  metadataCorsOptionsRequestHandler,
} from '@clerk/mcp-tools/next'

const handler = authServerMetadataHandlerClerk()
const corsOptionsHandler = metadataCorsOptionsRequestHandler()

export { handler as GET, corsOptionsHandler as OPTIONS }
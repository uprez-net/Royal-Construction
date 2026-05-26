import { z } from 'zod';
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { customerLookupQuerySchema, customerLookupResponseSchema } from '@/utils/validators';
import { getCachedCustomersForDropdown } from '@/lib/data/customers';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types';
import { verifyToken as clerkTokenVerification } from "@clerk/nextjs/server";

const handler = createMcpHandler((server) => {
    server.registerTool("get_customer", {
        description: "Get customer information for project creation",
        inputSchema: customerLookupQuerySchema,
        outputSchema: customerLookupResponseSchema
    },
        async (params) => {
            const data = await getCachedCustomersForDropdown(
                params.page,
                params.limit,
                params.q || params.search
            );

            return {
                structuredContent: data,
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(data)
                    }
                ]
            };
        }
    )
},
    {
        serverInfo: {
            name: "MCP Royal Construction",
            version: "1.0.0",
        }

    },
    {
        basePath: "/api/mcp",
    }
)

const verifyToken = async (
    req: Request,
    bearerToken?: string,
): Promise<AuthInfo | undefined> => {
    if (!bearerToken) return undefined;

    try {
        const payload = await clerkTokenVerification(bearerToken, {
            
        });

        return {
            token: bearerToken,
            clientId: payload.sub,
            scopes: ["read:stuff"],
            extra: payload,
        };
    } catch {
        return undefined;
    }
};

const authHandler = withMcpAuth(handler, verifyToken, {
    required: true,
    requiredScopes: ['read:stuff'],
    resourceMetadataPath: '/.well-known/oauth-protected-resource',
});


export { authHandler as GET, authHandler as POST, authHandler as DELETE };
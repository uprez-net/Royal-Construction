import type { Role } from "@prisma/client";

declare global {
    interface CustomJwtSessionClaims {
        userId: string;
        public_metadata: {
            role: Role;
            customerId: string | null;
        }
    }
}
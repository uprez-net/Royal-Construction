import type { Role } from "@prisma/client";

declare global {
    interface CustomJwtSessionClaims {
        userId: string;
        firstName?: string;
        lastName?: string;
        emailAddress?: string;
        phoneNumber?: string;
        public_metadata: {
            role: Role;
            customerId: string | null;
        }
    }
}
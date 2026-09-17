import { defineRCSpecialist } from "@/agent/lib/specialist-config";

export default defineRCSpecialist(
  "Handle Royal Construction admin approvals, offer-content defaults, team membership, and Xero connection administration. Admin-only reads and writes must verify the current caller; destructive or externally visible changes require owner approval.",
);

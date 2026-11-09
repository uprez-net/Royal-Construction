import type { Metadata } from "next";

import { CommsAdminPanel } from "@/components/admin/comms-admin-panel";

export const metadata: Metadata = {
  title: "Phone & SMS",
  description:
    "Which phone provider is active, its numbers and webhooks, and texts and calls from numbers no lead has.",
};

export default function AdminCommsPage() {
  return <CommsAdminPanel />;
}

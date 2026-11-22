import { Suspense } from "react";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import {
  WhatsAppBridgeAdmin,
  type WhatsAppBridgeAdminConfig,
} from "@/components/admin/whatsapp-bridge/whatsapp-bridge-admin";
import { PageHeader } from "@/components/common/page-header";
import { requireAdminUser } from "@/lib/auth/require-admin";
import { readWhatsAppBridgeConfig } from "@/lib/whatsapp-bridge/config";

import WhatsAppBridgeSkeleton from "./loading";

export const metadata: Metadata = {
  title: "WhatsApp bridge",
  description:
    "Link Royal's WhatsApp number for project groups, and choose which group belongs to which project.",
};

const WEBHOOK_PATH = "/api/whatsapp-bridge/webhook";

async function WhatsAppBridgeContent() {
  // Live configuration; the session and groups load in the browser so a slow
  // bridge never holds up the page.
  await connection();
  const guard = await requireAdminUser();
  if (!guard.ok) redirect("/dashboard");

  const bridge = readWhatsAppBridgeConfig();
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  let bridgeHost: string | null = null;
  try {
    bridgeHost = bridge.url ? new URL(bridge.url).host : null;
  } catch {
    bridgeHost = null;
  }
  const config: WhatsAppBridgeAdminConfig = {
    bridgeHost,
    configured: bridge.enabled,
    problems: bridge.problems,
    webhookUrl: base ? `${base}${WEBHOOK_PATH}` : null,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        headingLevel="h1"
        title="WhatsApp bridge"
        description="Project groups run on Royal's own WhatsApp number. Lead messages and calls stay on the WhatsApp Business API (Admin › WhatsApp)."
      />
      <WhatsAppBridgeAdmin config={config} />
    </div>
  );
}

export default function AdminWhatsAppBridgePage() {
  return (
    <Suspense fallback={<WhatsAppBridgeSkeleton />}>
      <WhatsAppBridgeContent />
    </Suspense>
  );
}

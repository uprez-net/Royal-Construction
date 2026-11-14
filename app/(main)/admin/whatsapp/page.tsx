import { Suspense } from "react";

import type { Metadata } from "next";
import { connection } from "next/server";

import {
  WhatsAppMetaHealthPanel,
  WhatsAppMetaHealthSkeleton,
  WhatsAppStatusPanel,
} from "@/components/admin/whatsapp-status-panel";
import { currentPrincipal } from "@/lib/data/current-principal";
import { getWhatsAppOperationalCounts } from "@/lib/domain/integrations/whatsapp";
import prisma from "@/lib/prisma";
import {
  checkWhatsAppWithMeta,
  whatsappAdminConfig,
} from "@/lib/whatsapp/admin-status";

import WhatsAppAdminSkeleton from "./loading";

export const metadata: Metadata = {
  title: "WhatsApp",
  description:
    "Which WhatsApp number is connected, where its webhook points, and what is turned on.",
};

async function MetaHealth() {
  const health = await checkWhatsAppWithMeta();
  return <WhatsAppMetaHealthPanel health={health} />;
}

async function WhatsAppAdminContent() {
  // Live configuration and counts; never prerendered.
  await connection();
  const principal = await currentPrincipal();
  const counts = await getWhatsAppOperationalCounts(principal, prisma);
  const config = whatsappAdminConfig();

  return (
    <div className="space-y-6">
      <WhatsAppStatusPanel config={config} counts={counts} />
      {/* Meta can take a few seconds; the rest of the page does not wait. */}
      <Suspense fallback={<WhatsAppMetaHealthSkeleton />}>
        <MetaHealth />
      </Suspense>
    </div>
  );
}

export default function AdminWhatsAppPage() {
  return (
    <Suspense fallback={<WhatsAppAdminSkeleton />}>
      <WhatsAppAdminContent />
    </Suspense>
  );
}

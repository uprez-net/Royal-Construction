import { Suspense } from "react";
import { isAgentFeatureEnabled } from "@/agent/lib/session-identity";
import { AppShell } from "@/components/common/app-shell";
import { auth } from "@clerk/nextjs/server";
import { AppShellLoader } from "@/components/common/app-shell-loader";
import { getUserByClerkIdCached } from "@/lib/data/user";
import { isInternalRole } from "@/lib/domain/principal";
import { readWhatsAppConfig } from "@/lib/whatsapp/config";

async function LayoutContent({ children }: { children: React.ReactNode }) {
  const user = await auth().then(async ({ userId }) =>
    userId ? await getUserByClerkIdCached(userId) : null,
  );
  // Read per request, after auth: the shell's WhatsApp pollers start only when
  // this deployment has WhatsApp switched on.
  const whatsappConfig = readWhatsAppConfig();

  return (
    <AppShell
      isAdmin={user?.role === "ADMIN"}
      description="Royal Constructions - One place for all your construction project management needs."
      isSignedIn={!!user}
      phoneEnabled={user ? isInternalRole(user.role) : false}
      whatsapp={{
        calling: whatsappConfig.channel?.callingEnabled === true,
        enabled: whatsappConfig.enabled,
      }}
      operationsAgentEnabled={isAgentFeatureEnabled()}
    >
      {children}
    </AppShell>
  );
}

function LayoutFallback({ children }: { children: React.ReactNode }) {
  return <AppShellLoader>{children}</AppShellLoader>;
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<LayoutFallback>{children}</LayoutFallback>}>
      <LayoutContent>{children}</LayoutContent>
    </Suspense>
  );
}

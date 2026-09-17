import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgentWorkspace } from "@/components/agent/agent-workspace";
import { AgentWorkspaceSkeleton } from "@/components/agent/agent-workspace-skeleton";
import { getAgentWorkspaceData } from "@/lib/data/agent-sessions";

export const metadata: Metadata = {
  title: "Operations Agent",
  description:
    "Work with Royal Constructions business operations through the authenticated agent.",
};

async function NewAgentWorkspace() {
  await connection();
  const data = await getAgentWorkspaceData();
  return (
    <AgentWorkspace
      initialSessions={data.sessions}
      selectedSessionId={data.selectedSessionId}
    />
  );
}

export default function AgentPage() {
  return (
    <Suspense fallback={<AgentWorkspaceSkeleton />}>
      <NewAgentWorkspace />
    </Suspense>
  );
}

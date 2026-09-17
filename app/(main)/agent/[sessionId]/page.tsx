import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AgentWorkspace } from "@/components/agent/agent-workspace";
import { AgentWorkspaceSkeleton } from "@/components/agent/agent-workspace-skeleton";
import { getAgentWorkspaceData } from "@/lib/data/agent-sessions";

async function ExistingAgentWorkspace({ sessionId }: { sessionId: string }) {
  await connection();
  const data = await getAgentWorkspaceData(sessionId);
  if (data.selectedSessionUnavailable) notFound();
  return (
    <AgentWorkspace
      initialSessions={data.sessions}
      selectedSessionId={data.selectedSessionId}
    />
  );
}

async function AgentSessionRoute({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ExistingAgentWorkspace sessionId={sessionId} />;
}

export default function AgentSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <Suspense fallback={<AgentWorkspaceSkeleton />}>
      <AgentSessionRoute params={params} />
    </Suspense>
  );
}

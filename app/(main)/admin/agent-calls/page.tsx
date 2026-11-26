import type { Metadata } from "next";

import { AgentCallsPanel } from "@/components/admin/agent-calls-panel";

export const metadata: Metadata = {
  title: "Agent calls",
  description:
    "Calls Mili makes to the owner for Hermes: scheduled, ringing and done, with transcripts, recordings and what she looked up.",
};

export default function AdminAgentCallsPage() {
  return <AgentCallsPanel />;
}

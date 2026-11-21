"use client";

import { AlertTriangle } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { GroupsCard } from "./groups-card";
import { SessionCard } from "./session-card";

// Admin › WhatsApp bridge: the bridge's session and login QR (session-card),
// and every group with the project it belongs to (groups-card). Server state
// lives in React Query (bridge-queries.ts).

export type WhatsAppBridgeAdminConfig = {
  readonly configured: boolean;
  /** The bridge's host, never the token. */
  readonly bridgeHost: string | null;
  /** What to set the bridge's APP_WEBHOOK_URL to. */
  readonly webhookUrl: string | null;
  readonly problems: readonly string[];
};

export function WhatsAppBridgeAdmin({
  config,
}: {
  config: WhatsAppBridgeAdminConfig;
}) {
  if (!config.configured) return <NotConfigured config={config} />;
  return (
    <div className="space-y-6">
      {config.problems.length > 0 ? (
        <Problems problems={config.problems} />
      ) : null}
      <SessionCard bridgeHost={config.bridgeHost} />
      <GroupsCard />
    </div>
  );
}

function Problems({ problems }: { problems: readonly string[] }) {
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-warning/30 bg-warning-light px-4 py-3 text-sm text-foreground"
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0 text-warning-ink"
        aria-hidden="true"
      />
      <ul className="space-y-1">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </div>
  );
}

function NotConfigured({ config }: { config: WhatsAppBridgeAdminConfig }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The WhatsApp bridge isn&apos;t set up</CardTitle>
        <CardDescription>
          Project groups run through a small service on its own server, linked
          to Royal&apos;s WhatsApp number by QR code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {config.problems.length > 0 ? (
          <Problems problems={config.problems} />
        ) : null}
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Deploy the bridge from <code>services/whatsapp-bridge</code> (its
            README has the steps).
          </li>
          <li>
            Set <code>WHATSAPP_BRIDGE_URL</code>,{" "}
            <code>WHATSAPP_BRIDGE_API_TOKEN</code> and{" "}
            <code>WHATSAPP_BRIDGE_WEBHOOK_SECRET</code> on this app, with the
            same tokens as the bridge&apos;s <code>.env</code>.
          </li>
          {config.webhookUrl ? (
            <li>
              Point the bridge&apos;s <code>APP_WEBHOOK_URL</code> at{" "}
              <code className="break-all">{config.webhookUrl}</code>.
            </li>
          ) : null}
          <li>Come back here and scan the QR code.</li>
        </ol>
      </CardContent>
    </Card>
  );
}

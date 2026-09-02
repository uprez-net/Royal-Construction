"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plug, PlugZap } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { XeroConnectionStatus } from "@/lib/data/xero-connection";
import { dateFormat } from "@/utils/formatters";

interface XeroConnectionPanelProps {
  status: XeroConnectionStatus;
  /** An error CODE from the connect route, not a message. See `ERROR_COPY`. */
  errorCode?: string;
  connected?: boolean;
}

/**
 * The wording lives here, not in the route.
 *
 * The connect route hands back a short code and this maps it. Query strings are
 * attacker-controllable through a crafted link, so an unrecognised code renders
 * nothing at all rather than becoming text on an admin page.
 */
const ERROR_COPY: Record<string, string> = {
  access_denied: "The Xero authorisation was declined, so nothing has changed.",
  invalid_scope:
    "Xero rejected the requested permissions. Check the app's scopes in the Xero developer portal.",
  refused: "Xero refused the authorisation request. Check the server logs.",
  expired: "The connection attempt expired. Start it again from this page.",
  no_refresh_token:
    "Xero returned no refresh token. Check that the app requests the offline_access scope.",
  no_tenant: "No Xero organisation was authorised for this app.",
  failed: "Could not complete the Xero connection. Check the server logs.",
};

/** Warn while there is still time to act, rather than on the day it dies. */
const EXPIRY_WARNING_DAYS = 14;

function daysUntil(date: Date | null): number | null {
  if (!date) {
    return null;
  }

  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
    <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
    <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
  </div>
);

export function XeroConnectionPanel({
  status,
  errorCode,
  connected,
}: XeroConnectionPanelProps) {
  const error = errorCode ? ERROR_COPY[errorCode] : undefined;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const daysLeft = daysUntil(status.refreshTokenExpiresAt);
  const isExpiring =
    daysLeft !== null && daysLeft <= EXPIRY_WARNING_DAYS && daysLeft > 0;
  const hasExpired = daysLeft !== null && daysLeft <= 0;

  const disconnect = async () => {
    setIsDisconnecting(true);
    try {
      const response = await fetch("/api/xero/connect", { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Disconnect failed with ${response.status}`);
      }
      toast.success("Xero disconnected.");
      startTransition(() => router.refresh());
    } catch (disconnectError) {
      console.error("Xero disconnect failed", disconnectError);
      toast.error("Could not disconnect Xero. Try again.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive-light p-4"
        >
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0 text-destructive-ink"
            aria-hidden="true"
          />
          <p className="text-sm text-destructive-ink">{error}</p>
        </div>
      ) : null}

      {connected && !error ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-success/40 bg-success-light p-4"
        >
          <CheckCircle2
            className="mt-0.5 size-5 shrink-0 text-success-ink"
            aria-hidden="true"
          />
          <p className="text-sm text-success-ink">
            Xero is connected. Progress claims will be raised automatically as
            contract stages complete.
          </p>
        </div>
      ) : null}

      <Card className="rounded-xl border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle as="h2" className="text-base font-semibold text-foreground">
                Xero connection
              </CardTitle>
              <CardDescription>
                The organisation progress claims are raised in. Claims are
                created when every milestone in a contract stage is finished,
                and payment status flows back through Xero&apos;s webhook.
              </CardDescription>
            </div>

            <StatusPill
              tone={
                !status.connected
                  ? "neutral"
                  : hasExpired
                    ? "danger"
                    : isExpiring
                      ? "warning"
                      : "success"
              }
            >
              {!status.connected
                ? "Not connected"
                : hasExpired
                  ? "Expired"
                  : isExpiring
                    ? "Expiring soon"
                    : "Connected"}
            </StatusPill>
          </div>
        </CardHeader>

        <CardContent className="pt-5">
          {status.connected ? (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <Detail
                  label="Organisation"
                  value={status.tenantName ?? "Unnamed organisation"}
                />
                <Detail
                  label="Connected by"
                  value={status.connectedByName ?? "Unknown"}
                />
                <Detail
                  label="Connected on"
                  value={
                    status.connectedAt
                      ? dateFormat.format(new Date(status.connectedAt))
                      : "—"
                  }
                />
                <Detail
                  label="Authorisation valid until"
                  value={
                    status.refreshTokenExpiresAt
                      ? `${dateFormat.format(new Date(status.refreshTokenExpiresAt))}${
                          daysLeft !== null && daysLeft > 0 ? ` (${daysLeft} days)` : ""
                        }`
                      : "—"
                  }
                />
              </dl>

              {isExpiring || hasExpired ? (
                <p className="mt-4 text-sm text-warning-ink">
                  Xero drops a refresh token 60 days after it was last used, and
                  the failure is silent — claims simply stop being raised.
                  Reconnect to reset the clock.
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-3">
                {/* A real link, not a router push: this route answers with a
                    redirect to Xero's consent screen, so the browser has to
                    leave the app rather than ask the client router for a page
                    that does not exist. */}
                <Button asChild disabled={isPending || isDisconnecting}>
                  <a href="/api/xero/connect">
                    <PlugZap className="size-4" aria-hidden="true" />
                    Reconnect
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={disconnect}
                  disabled={isPending || isDisconnecting}
                >
                  {isDisconnecting ? "Disconnecting…" : "Disconnect"}
                </Button>
              </div>
            </>
          ) : (
            <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-8 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-muted">
                <Plug className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>

              <p className="text-base font-semibold text-foreground">
                No Xero organisation is connected
              </p>

              <p className="text-sm text-muted-foreground">
                Until one is, completing a contract stage records the milestones
                but raises no progress claim.
              </p>

              {/* See the Reconnect button: this leaves the app for Xero. */}
              <Button asChild className="mt-2">
                <a href="/api/xero/connect">
                  <PlugZap className="size-4" aria-hidden="true" />
                  Connect Xero
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

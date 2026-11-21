"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, QrCode, RefreshCw, Smartphone } from "lucide-react";

import { StatusPill } from "@/components/common/status-pill";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import type { WhatsAppBridgeSessionDto } from "@/lib/whatsapp-bridge/admin-service";
import { cn } from "@/lib/utils";

import {
  errorText,
  isPairing,
  useBridgeQr,
  useBridgeSession,
  useConnectBridge,
  useDisconnectBridge,
  when,
} from "./bridge-queries";

const STATUS: Record<
  WhatsAppBridgeSessionDto["status"],
  { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }
> = {
  awaiting_qr: { label: "Waiting for scan", tone: "info" },
  closed: { label: "Disconnected", tone: "danger" },
  connecting: { label: "Connecting", tone: "info" },
  logged_out: { label: "Not linked", tone: "warning" },
  open: { label: "Connected", tone: "success" },
  starting: { label: "Starting", tone: "info" },
};

/**
 * Whether the bridge is linked to Royal's number, the QR code to link it, a
 * Disconnect, and how event delivery to the app is going.
 */
export function SessionCard({ bridgeHost }: { bridgeHost: string | null }) {
  const sessionQuery = useBridgeSession();
  const session = sessionQuery.data;
  const qrQuery = useBridgeQr(Boolean(session?.qrAvailable));
  const qr = session?.qrAvailable ? (qrQuery.data ?? null) : null;
  const connect = useConnectBridge();
  const disconnect = useDisconnectBridge();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const busy = connect.isPending || disconnect.isPending;
  const pairing = connect.isPending || isPairing(session);

  function startConnect() {
    connect.mutate(undefined, {
      onError: (error) =>
        toast.error(errorText(error, "Could not start the WhatsApp bridge.")),
    });
  }

  function confirmLogout() {
    disconnect.mutate(undefined, {
      onError: (error) =>
        toast.error(
          errorText(error, "Could not disconnect the WhatsApp bridge."),
        ),
      onSuccess: (next) => {
        setConfirmDisconnect(false);
        toast.success(
          next.lastDisconnect?.reason
            ?? "The WhatsApp bridge is disconnected from Royal's number.",
        );
      },
    });
  }

  const status = session ? STATUS[session.status] : null;
  const outbox = session?.outbox;
  const outboxTrouble =
    outbox && (outbox.dead > 0 || (outbox.pending > 0 && outbox.lastError));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Smartphone
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            Royal&apos;s WhatsApp number
          </CardTitle>
          <CardDescription>
            The bridge is linked to Royal&apos;s number like WhatsApp Web, and
            reads and posts in the project groups for the app.
            {bridgeHost ? ` Bridge: ${bridgeHost}.` : ""}
          </CardDescription>
        </div>
        {status ? (
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {sessionQuery.isError && !session ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive-light px-4 py-3 text-sm">
            <p role="alert" className="text-destructive-ink">
              {errorText(
                sessionQuery.error,
                "Could not reach the WhatsApp bridge.",
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void sessionQuery.refetch()}
            >
              <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
              Try again
            </Button>
          </div>
        ) : !session ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Asking the bridge…
          </p>
        ) : session.status === "open" ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Linked number</dt>
                <dd className="font-semibold tabular-nums">
                  {session.account?.phoneE164
                    ? formatE164ForDisplay(session.account.phoneE164)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">WhatsApp name</dt>
                <dd className="font-semibold">
                  {session.account?.name ?? "—"}
                </dd>
              </div>
            </dl>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDisconnect(true)}
              disabled={busy}
              className="text-destructive-ink"
            >
              <LogOut className="mr-1.5 size-4" aria-hidden="true" />
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
            <div className="flex size-[240px] max-w-full items-center justify-center self-center justify-self-center rounded-xl border border-border bg-white p-3">
              {qr ? (
                // A data: URL the bridge rendered; next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr.dataUrl}
                  alt="QR code to link Royal's WhatsApp number to the bridge"
                  className="size-full"
                />
              ) : pairing ? (
                <Loader2
                  className="size-8 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <QrCode
                  className="size-16 text-muted-foreground/40"
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="space-y-3 text-sm">
              {qr ? (
                <>
                  <p className="font-medium text-foreground">
                    Scan this with the phone that has Royal&apos;s WhatsApp:
                  </p>
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    <li>Open WhatsApp › Settings › Linked devices.</li>
                    <li>Tap “Link a device” and point the camera here.</li>
                  </ol>
                  <p className="text-xs text-muted-foreground">
                    The code changes every few seconds; this page keeps up.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-foreground">
                    {session.status === "logged_out"
                      ? "The bridge isn't linked to Royal's number, so project group messages aren't coming in."
                      : "Connecting to WhatsApp…"}
                  </p>
                  {session.lastDisconnect ? (
                    <p className="text-xs text-muted-foreground">
                      Last disconnected {when(session.lastDisconnect.at)}:{" "}
                      {session.lastDisconnect.reason}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    onClick={startConnect}
                    disabled={busy || pairing}
                    className="bg-primary text-primary-foreground"
                  >
                    {pairing ? (
                      <Loader2
                        className="mr-1.5 size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <QrCode className="mr-1.5 size-4" aria-hidden="true" />
                    )}
                    Show login QR code
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {outbox ? (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              outboxTrouble
                ? "border-warning/30 bg-warning-light"
                : "border-border/70 bg-muted/40",
            )}
          >
            <p className="font-medium text-foreground">Messages to the app</p>
            <p className="mt-0.5 text-muted-foreground">
              {!outbox.delivering
                ? "The bridge has no APP_WEBHOOK_URL, so messages wait on its server."
                : outbox.pending === 0
                  ? `All delivered. Last one ${when(outbox.lastDeliveredAt)}.`
                  : `${outbox.pending} waiting to be delivered${outbox.lastError ? ` — ${outbox.lastError}` : ""}.`}
              {outbox.dead > 0
                ? ` ${outbox.dead} refused by the app and set aside on the bridge's server (outbox-dead).`
                : ""}
            </p>
          </div>
        ) : null}
      </CardContent>

      <AlertDialog
        open={confirmDisconnect}
        onOpenChange={(open) => {
          if (!open && !disconnect.isPending) setConfirmDisconnect(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect the WhatsApp bridge?</AlertDialogTitle>
            <AlertDialogDescription>
              The bridge is unlinked from Royal&apos;s number (it disappears
              from Linked devices on the phone). Project group messages stop
              coming in, and nothing can be sent to the groups, until someone
              scans a new QR code. The groups and their links to projects are
              kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={disconnect.isPending}
              onClick={confirmLogout}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

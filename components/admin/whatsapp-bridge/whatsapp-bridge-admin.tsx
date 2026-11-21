"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ExternalLink,
  Link2,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  Search,
  Smartphone,
  Unlink,
  Users,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { UnlinkWhatsAppGroupDialog } from "@/components/whatsapp/unlink-whatsapp-group-dialog";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import type { WhatsAppBridgeGroupDto } from "@/lib/projects/whatsapp-types";
import {
  connectBridge,
  disconnectBridge,
  fetchBridgeGroups,
  fetchBridgeQr,
  fetchBridgeSession,
  resyncBridgeGroups,
  unlinkBridgeGroup,
  type WhatsAppBridgeSessionDto,
} from "@/lib/whatsapp-bridge/admin-service";
import { cn } from "@/lib/utils";

import { LinkGroupToProjectModal } from "./link-group-to-project-modal";

/** Fast while someone is mid-scan; slow while it just sits connected. */
const PAIRING_POLL_MS = 3_000;
const IDLE_POLL_MS = 30_000;

const WHEN = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  timeZone: "Australia/Sydney",
});

function when(iso: string | null | undefined): string {
  return iso ? WHEN.format(new Date(iso)) : "—";
}

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
      <SessionCard config={config} />
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

// ── Session ───────────────────────────────────────────────────────────────

function SessionCard({ config }: { config: WhatsAppBridgeAdminConfig }) {
  const [session, setSession] = useState<WhatsAppBridgeSessionDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<{
    dataUrl: string;
    issuedAt: string | null;
  } | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const next = await fetchBridgeSession(controller.signal);
      setSession(next);
      setError(null);
      if (next.qrAvailable) {
        setQr(await fetchBridgeQr(controller.signal));
      } else {
        setQr(null);
      }
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not reach the WhatsApp bridge.",
      );
    }
  }, []);

  const pairing =
    busy === "connect"
    || session?.status === "connecting"
    || session?.status === "awaiting_qr"
    || session?.status === "starting";

  useEffect(() => {
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      pairing ? PAIRING_POLL_MS : IDLE_POLL_MS,
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [pairing, refresh]);

  async function connect() {
    if (busy) return;
    setBusy("connect");
    try {
      setSession(await connectBridge());
      // The QR takes a few seconds to arrive; the fast poll picks it up.
      window.setTimeout(() => void refresh(), 1_500);
    } catch (connectError) {
      toast.error(
        connectError instanceof Error
          ? connectError.message
          : "Could not start the WhatsApp bridge.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy("disconnect");
    try {
      setSession(await disconnectBridge());
      setQr(null);
      setConfirmDisconnect(false);
      toast.success("The WhatsApp bridge is disconnected from Royal's number.");
    } catch (disconnectError) {
      toast.error(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Could not disconnect the WhatsApp bridge.",
      );
    } finally {
      setBusy(null);
    }
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
            {config.bridgeHost ? ` Bridge: ${config.bridgeHost}.` : ""}
          </CardDescription>
        </div>
        {status ? (
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive-light px-4 py-3 text-sm">
            <p role="alert" className="text-destructive-ink">
              {error}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
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
              disabled={busy !== null}
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
                    onClick={() => void connect()}
                    disabled={busy !== null || pairing}
                    className="bg-primary text-primary-foreground"
                  >
                    {busy === "connect" || pairing ? (
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
          if (!open && busy !== "disconnect") setConfirmDisconnect(false);
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
            <AlertDialogCancel disabled={busy === "disconnect"}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === "disconnect"}
              onClick={() => void disconnect()}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Groups ────────────────────────────────────────────────────────────────

function GroupsCard() {
  const [groups, setGroups] = useState<WhatsAppBridgeGroupDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [version, setVersion] = useState(0);
  const [linking, setLinking] = useState<WhatsAppBridgeGroupDto | null>(null);
  const [unlinking, setUnlinking] = useState<WhatsAppBridgeGroupDto | null>(
    null,
  );
  const [busy, setBusy] = useState<"unlink" | "resync" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchBridgeGroups(controller.signal)
      .then((result) => {
        setGroups(result.groups);
        setError(null);
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not list the WhatsApp groups.",
        );
      });
    return () => controller.abort();
  }, [version]);

  const reload = () => setVersion((value) => value + 1);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (groups ?? []).filter((group) => {
      if (filter === "linked" && !group.linkedProject) return false;
      if (filter === "unlinked" && group.linkedProject) return false;
      if (!needle) return true;
      return (
        group.subject.toLowerCase().includes(needle)
        || group.linkedProject?.name.toLowerCase().includes(needle)
        || group.linkedProject?.location.toLowerCase().includes(needle)
      );
    });
  }, [groups, query, filter]);

  const drift = (groups ?? []).filter((group) => group.mappingDrift).length;
  const linkedCount = (groups ?? []).filter(
    (group) => group.linkedProject,
  ).length;

  async function resync() {
    if (busy) return;
    setBusy("resync");
    try {
      const result = await resyncBridgeGroups();
      toast.success(
        result.added + result.removed + result.changed === 0
          ? `The bridge already had all ${result.total} linked groups.`
          : `Resynced: ${result.added} added, ${result.changed} moved, ${result.removed} removed.`,
      );
      reload();
    } catch (resyncError) {
      toast.error(
        resyncError instanceof Error
          ? resyncError.message
          : "Could not resync.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function unlink() {
    const group = unlinking;
    if (!group?.linkedProject || busy) return;
    setBusy("unlink");
    try {
      const result = await unlinkBridgeGroup(group.linkedProject.id);
      toast.success(
        result.bridgeUpdated
          ? `“${group.subject}” unlinked from ${group.linkedProject.name}.`
          : "Unlinked. The bridge couldn't be told right now; press Resync shortly.",
      );
      setUnlinking(null);
      reload();
    } catch (unlinkError) {
      toast.error(
        unlinkError instanceof Error
          ? unlinkError.message
          : "Could not unlink.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Users
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            Groups and projects
          </CardTitle>
          <CardDescription>
            Every group Royal&apos;s number is in. Only groups linked to a
            project come into the app; the rest stay private on the phone.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void resync()}
            disabled={busy !== null}
            title="Tell the bridge exactly which groups to forward"
          >
            {busy === "resync" ? (
              <Loader2
                className="mr-1.5 size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            Resync
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {drift > 0 ? (
          <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-light px-3 py-2 text-sm">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-warning-ink"
              aria-hidden="true"
            />
            {drift === 1 ? "1 group is" : `${drift} groups are`} forwarded
            differently by the bridge than the app expects. Press Resync.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search groups or projects"
              aria-label="Search groups or projects"
              className="pl-9"
            />
          </div>
          <div
            className="flex gap-1 rounded-lg bg-muted p-1"
            role="group"
            aria-label="Show"
          >
            {(["all", "linked", "unlinked"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm capitalize",
                  filter === value
                    ? "bg-card font-medium text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {value === "unlinked" ? "Not linked" : value}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="space-y-2 py-6 text-center">
            <p role="alert" className="text-sm text-destructive-ink">
              {error}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : !groups ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Asking WhatsApp for Royal&apos;s groups…
          </p>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Royal&apos;s number isn&apos;t in any groups yet. Create one from a
            project&apos;s WhatsApp tab.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {groups.length} group{groups.length === 1 ? "" : "s"} ·{" "}
              {linkedCount} linked to a project
            </p>
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing matches.
              </p>
            ) : (
              <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
                {shown.map((group) => (
                  <GroupRow
                    key={group.groupJid}
                    group={group}
                    onLink={() => setLinking(group)}
                    onUnlink={() => setUnlinking(group)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>

      {linking ? (
        <LinkGroupToProjectModal
          group={linking}
          onClose={() => setLinking(null)}
          onLinked={() => {
            setLinking(null);
            reload();
          }}
        />
      ) : null}
      {unlinking ? (
        <UnlinkWhatsAppGroupDialog
          open
          subject={unlinking.subject}
          projectName={unlinking.linkedProject?.name ?? null}
          pending={busy === "unlink"}
          onOpenChange={(open) => {
            if (!open && busy !== "unlink") setUnlinking(null);
          }}
          onConfirm={() => void unlink()}
        />
      ) : null}
    </Card>
  );
}

function GroupRow({
  group,
  onLink,
  onUnlink,
}: {
  group: WhatsAppBridgeGroupDto;
  onLink: () => void;
  onUnlink: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">
          {group.subject || "Untitled group"}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
          </span>
          {group.createdAt ? (
            <span>· created {when(group.createdAt)}</span>
          ) : null}
          {!group.isAdmin ? (
            <span>· Royal isn&apos;t an admin (no invite link)</span>
          ) : null}
          {group.mappingDrift ? (
            <span className="font-medium text-warning-ink">· needs resync</span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {group.linkedProject ? (
          <>
            <Link
              href={`/projects/${group.linkedProject.id}?activeTab=communications&channel=whatsapp`}
              className="inline-flex max-w-[260px] items-center gap-1 truncate rounded-full bg-success-light px-3 py-1 text-xs font-medium text-success-ink hover:underline"
            >
              <span className="truncate">
                {group.linkedProject.location || group.linkedProject.name}
              </span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </Link>
            <Button type="button" size="sm" variant="ghost" onClick={onUnlink}>
              <Unlink className="mr-1.5 size-3.5" aria-hidden="true" />
              Unlink
            </Button>
          </>
        ) : (
          <>
            <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              Not linked
            </span>
            <Button type="button" size="sm" variant="outline" onClick={onLink}>
              <Link2 className="mr-1.5 size-3.5" aria-hidden="true" />
              Link to project
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

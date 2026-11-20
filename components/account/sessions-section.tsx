"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession, useUser } from "@clerk/nextjs";
import { Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatSydneyDateTime } from "@/lib/dates/sydney";

import { clerkErrorMessage, wasReverificationCancelled } from "./clerk-error";
import { useVerifiedAction } from "./reverification";

type UserResource = NonNullable<ReturnType<typeof useUser>["user"]>;
type DeviceSession = Awaited<ReturnType<UserResource["getSessions"]>>[number];

function deviceName(session: DeviceSession): string {
  const activity = session.latestActivity;
  const browser = [activity?.browserName, activity?.browserVersion]
    .filter(Boolean)
    .join(" ");
  const device = activity?.deviceType;
  return [browser, device].filter(Boolean).join(" on ") || "Unknown device";
}

function whereFrom(session: DeviceSession): string | null {
  const activity = session.latestActivity;
  const place = [activity?.city, activity?.country].filter(Boolean).join(", ");
  return [place, activity?.ipAddress].filter(Boolean).join(" · ") || null;
}

/** Every device signed in to this account, and signing one out. */
export function SessionsSection() {
  const { user } = useUser();
  const { session: current } = useSession();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | "others" | null>(null);

  const revoke = useVerifiedAction((session: DeviceSession) =>
    session.revoke(),
  );

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const all = await user.getSessions();
      setSessions(
        all
          .filter((session) => session.status === "active")
          .sort(
            (a, b) =>
              new Date(b.lastActiveAt).getTime()
              - new Date(a.lastActiveAt).getTime(),
          ),
      );
      setError(null);
    } catch (loadError) {
      setError(clerkErrorMessage(loadError, "Could not load your devices."));
    }
  }, [user]);

  useEffect(() => {
    // Deferred a tick: never setState in the effect body.
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const others = (sessions ?? []).filter((s) => s.id !== current?.id);

  async function signOut(targets: DeviceSession[], key: string) {
    setRevoking(key);
    try {
      for (const target of targets) await revoke(target);
      toast.success(
        targets.length === 1
          ? "Signed that device out."
          : `Signed ${targets.length} devices out.`,
      );
    } catch (revokeError) {
      if (!wasReverificationCancelled(revokeError)) {
        toast.error(clerkErrorMessage(revokeError, "Could not sign it out."));
      }
    } finally {
      setRevoking(null);
      void load();
    }
  }

  return (
    <SectionCard
      title="Devices"
      description="Where your account is signed in. Sign out anything you don't recognise."
      action={
        others.length > 1 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void signOut(others, "others")}
            disabled={revoking !== null}
          >
            {revoking === "others" ? (
              <Spinner className="size-3.5" aria-hidden="true" />
            ) : null}
            Sign out all others
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p role="alert" className="text-destructive-ink">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : !sessions ? (
        <div className="grid gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <ul className="divide-y divide-border/70">
          {sessions.map((session) => {
            const isCurrent = session.id === current?.id;
            const Icon = session.latestActivity?.isMobile
              ? Smartphone
              : Monitor;
            const from = whereFrom(session);
            return (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Icon
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {deviceName(session)}
                      </span>
                      {isCurrent ? (
                        <StatusPill tone="info">This device</StatusPill>
                      ) : null}
                    </div>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {from ? `${from} · ` : ""}
                      Last active{" "}
                      <span className="font-mono">
                        {formatSydneyDateTime(new Date(session.lastActiveAt))}
                      </span>
                    </p>
                  </div>
                </div>
                {!isCurrent ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void signOut([session], session.id)}
                    disabled={revoking !== null}
                  >
                    {revoking === session.id ? (
                      <Spinner className="size-3.5" aria-hidden="true" />
                    ) : null}
                    Sign out
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatSydneyDateTime } from "@/lib/dates/sydney";
import { FetchError, fetchJson } from "@/utils/fetch";

import { clerkErrorMessage, wasReverificationCancelled } from "./clerk-error";
import { useVerifiedAction } from "./reverification";

/** What `/api/account/sessions` answers: the caller's active sessions. */
type DeviceSession = {
  id: string;
  current: boolean;
  lastActiveAt: number;
  browserName: string | null;
  browserVersion: string | null;
  deviceType: string | null;
  isMobile: boolean;
  city: string | null;
  country: string | null;
  ipAddress: string | null;
};

function deviceName(session: DeviceSession): string {
  const browser = [session.browserName, session.browserVersion]
    .filter(Boolean)
    .join(" ");
  return (
    [browser, session.deviceType].filter(Boolean).join(" on ")
    || "Unknown device"
  );
}

function whereFrom(session: DeviceSession): string | null {
  const place = [session.city, session.country].filter(Boolean).join(", ");
  return [place, session.ipAddress].filter(Boolean).join(" · ") || null;
}

/**
 * Sign one device out. Clerk's reverification answer is handed back as is,
 * for `useVerifiedAction` to show the dialog and call this again.
 */
async function revokeSession(session: DeviceSession): Promise<unknown> {
  const response = await fetch(
    `/api/account/sessions/${encodeURIComponent(session.id)}`,
    { method: "DELETE" },
  );
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "clerk_error" in body) return body;
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "Could not sign it out.";
    throw new FetchError(message, response.status, body);
  }
  return body;
}

/** Every device signed in to this account, and signing one out. */
export function SessionsSection() {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | "others" | null>(null);

  const revoke = useVerifiedAction(revokeSession);

  // A fresh server read every time, so "Try again" and the reload after a
  // sign-out really ask Clerk again, and a failure shows as one.
  const load = useCallback(async () => {
    try {
      const response = await fetchJson<DeviceSession[]>(
        "/api/account/sessions",
        { cache: "no-store", method: "GET" },
        "Could not load your devices.",
      );
      setSessions(response.data);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load your devices.",
      );
    }
  }, []);

  useEffect(() => {
    // Deferred a tick: never setState in the effect body.
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const others = (sessions ?? []).filter((s) => !s.current);

  async function signOut(targets: DeviceSession[], key: string) {
    setRevoking(key);
    try {
      for (const target of targets) {
        const result = await revoke(target);
        // Still a reverification answer after the dialog: Clerk did not
        // accept the check, and the device is still signed in.
        if (result && typeof result === "object" && "clerk_error" in result) {
          throw new Error("Couldn't confirm it's you. Try again.");
        }
      }
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
            const isCurrent = session.current;
            const Icon = session.isMobile ? Smartphone : Monitor;
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

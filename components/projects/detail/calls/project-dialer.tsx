"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Minus,
  Phone,
  PhoneCall,
  RefreshCw,
  X,
} from "lucide-react";

import { useOptionalPhone } from "@/components/comms/phone-provider";
import { phoneKey } from "@/components/leads/comms/call-via-phone-button";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import { cn } from "@/lib/utils";

import { useProjectDialerRequest } from "./project-calls-events";
import { useProjectCalls } from "./project-calls-queries";
import { DialerKeypad } from "./project-dialer-keypad";
import { DialerPeople } from "./project-dialer-people";
import {
  useProjectCallPlacer,
  type CallRoute,
  type ProjectCallPlacer,
} from "./use-project-call-placer";

// The project's floating dialer (ADMIN only). Opened from the header's Call
// button: the project's people — site manager, owners, connected tradies —
// each one press from a call (./project-dialer-people.tsx), and a keypad for
// any other number (./project-dialer-keypad.tsx).
//
// Like every call from the CRM, the server rings the other person first and
// puts them through to this browser or a team phone once they answer
// (lib/domain/comms/calls/project.ts). Placing lives on the button
// (./use-project-call-placer.ts), so closing the panel mid-placement keeps
// the attempt and its key.

const TARGET_STORAGE_KEY = "comms:project-dialer-target";
const BROWSER = "browser";

function readTarget(): string | null {
  try {
    return window.localStorage.getItem(TARGET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberTarget(value: string) {
  try {
    window.localStorage.setItem(TARGET_STORAGE_KEY, value);
  } catch {
    // Private window or blocked storage: the pick lasts this visit only.
  }
}

/** The header's Call button, and the dialer it opens. */
export function ProjectDialerButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [open, setOpen] = useState(false);
  const phone = useOptionalPhone();
  const placer = useProjectCallPlacer(projectId, phone);
  const openDialer = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  useProjectDialerRequest(projectId, openDialer);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-9 rounded-lg px-3.5 text-sm font-medium"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {placer.placing ? (
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Phone className="mr-1.5 size-4" aria-hidden="true" />
        )}
        Call
      </Button>
      {open ? (
        <ProjectDialer
          projectId={projectId}
          projectName={projectName}
          phone={phone}
          placer={placer}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function ProjectDialer({
  projectId,
  projectName,
  phone,
  placer,
  onClose,
}: {
  projectId: string;
  projectName: string;
  phone: ReturnType<typeof useOptionalPhone>;
  placer: ProjectCallPlacer;
  onClose: () => void;
}) {
  const query = useProjectCalls(projectId);
  const data = query.data ?? null;
  const error = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Could not load the project's people."
    : null;
  const [view, setView] = useState<"people" | "keypad">("people");
  const [collapsed, setCollapsed] = useState(false);
  const [picked, setPicked] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readTarget(),
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = data?.options;
  // Where the call is put through: this browser, or one of the team's phones.
  const targets = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    if (options?.browser) list.push({ label: "This browser", value: BROWSER });
    for (const teamPhone of options?.phones ?? []) {
      list.push({
        label: `${teamPhone.nickname} (${formatE164ForDisplay(teamPhone.e164)})`,
        value: phoneKey(teamPhone),
      });
    }
    return list;
  }, [options]);
  const target =
    targets.find((item) => item.value === picked)?.value
    ?? targets[0]?.value
    ?? null;
  const route: CallRoute | null = !target
    ? null
    : target === BROWSER
      ? { target: "browser" }
      : {
          phone:
            options?.phones.find((item) => phoneKey(item) === target) ?? null,
          target: "mobile",
        };

  const onCall = phone?.active?.kind === "pstn" ? phone.active : null;
  const inBrowserCall = onCall?.phase === "active";
  const canCall = Boolean(options?.allowed && route) && !phone?.active;
  const { placing } = placer;

  return (
    <div
      role="dialog"
      aria-label={`Call someone on ${projectName}`}
      // pointer-events-auto: an open modal elsewhere switches pointer events
      // off outside it, and the dialer must stay usable. Top right, so the
      // phone dock (bottom right) never sits on top of it.
      className="pointer-events-auto fixed top-[calc(var(--topbar-h,4rem)+0.75rem)] right-4 z-50 flex max-h-[calc(100dvh-var(--topbar-h,4rem)-1.5rem)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <PhoneCall className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">Call</p>
          <p className="truncate text-xs text-muted-foreground">
            {projectName}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={collapsed ? "Expand the dialer" : "Minimise the dialer"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Close the dialer"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div
        className={cn("min-h-0 flex-1 flex-col", collapsed ? "hidden" : "flex")}
      >
        <div
          role="tablist"
          aria-label="Dialer"
          className="mx-3 mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        >
          {(["people", "keypad"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm font-medium transition-colors",
                view === key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {key === "people" ? "People" : "Keypad"}
            </button>
          ))}
        </div>

        {inBrowserCall ? (
          <p className="mx-3 mt-2 rounded-md bg-success-light px-2.5 py-1.5 text-xs text-success-ink">
            On a call with {onCall?.leadName ?? "the other person"}. The keypad
            sends tones.
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error ? (
            <p className="mb-2 rounded-md bg-destructive/10 px-2.5 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {!data && !error ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </div>
          ) : null}
          {data ? (
            <>
              <div hidden={view !== "people"}>
                <DialerPeople
                  contacts={data.contacts}
                  canCall={canCall}
                  busy={placing !== null}
                  placingKey={placing?.via === "people" ? placing.key : null}
                  onCall={(contact) =>
                    route
                      ? void placer.place(
                          {
                            kind: "contact",
                            label: contact.name,
                            ref: contact.ref,
                          },
                          route,
                        )
                      : undefined
                  }
                />
              </div>
              {/* Kept mounted while hidden, so a half-typed number survives
                  a look at People. */}
              <div hidden={view !== "keypad"}>
                <DialerKeypad
                  contacts={data.contacts}
                  canCall={canCall}
                  busy={placing !== null}
                  placing={placing?.via === "keypad"}
                  sendTone={
                    inBrowserCall && phone
                      ? (digit) => phone.sendDigits(digit)
                      : null
                  }
                  onCall={(e164, label) =>
                    route
                      ? placer.place({ e164, kind: "number", label }, route)
                      : Promise.resolve(false)
                  }
                />
              </div>
            </>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {options && !options.allowed ? (
            <p className="flex items-start gap-2 rounded-md bg-warning-light px-2.5 py-2 text-xs text-warning-ink">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              {options.reason}
            </p>
          ) : null}
          {targets.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">
                Take it on
              </span>
              <Select
                value={target ?? undefined}
                onValueChange={(value) => {
                  setPicked(value);
                  rememberTarget(value);
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 min-w-0 flex-1 text-xs"
                  aria-label="Where the call is put through"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-60">
                  {targets.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Reload the project's people"
                onClick={() => void query.refetch()}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ) : null}
          {target === BROWSER && phone && phone.status !== "ready" ? (
            <p className="text-xs text-muted-foreground">
              Browser phone:{" "}
              {phone.status === "connecting"
                ? "connecting…"
                : (phone.message ?? phone.status)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

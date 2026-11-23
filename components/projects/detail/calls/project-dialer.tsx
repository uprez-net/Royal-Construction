"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Delete,
  HardHat,
  Loader2,
  Minus,
  Phone,
  PhoneCall,
  RefreshCw,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { checkMicrophone } from "@/components/comms/microphone";
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
import { useIdempotencyKeys } from "@/hooks/use-idempotency-key";
import {
  formatE164ForDisplay,
  normaliseLeadPhone,
} from "@/lib/domain/leads/whatsapp/phone";
import { fetchProjectCalls, placeProjectCall } from "@/lib/leads/comms-service";
import type {
  ProjectCallContactDto,
  ProjectCallContactKindDto,
  ProjectCallsDto,
} from "@/lib/leads/comms-types";
import { cn } from "@/lib/utils";

import {
  announceProjectCallsChange,
  useProjectCallsChange,
  useProjectDialerRequest,
} from "./project-calls-events";

// The project's floating dialer (ADMIN only). Opened from the header's Call
// button: the project's people — site manager, owners, connected tradies —
// each one press from a call, and a keypad for any other number.
//
// Like every call from the CRM, the server rings the other person first and
// puts them through to this browser or a team phone once they answer
// (lib/domain/comms/calls/project.ts). During a browser call the keypad sends
// touch-tones instead, for a supplier's menu or an extension.

const TARGET_STORAGE_KEY = "comms:project-dialer-target";
const BROWSER = "browser";

const KEYS: readonly { digit: string; letters: string }[] = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

const GROUPS: readonly {
  kind: ProjectCallContactKindDto;
  label: string;
  icon: React.ElementType;
}[] = [
  { icon: HardHat, kind: "SITE_MANAGER", label: "Site manager" },
  { icon: UserRound, kind: "OWNER", label: "Owners" },
  { icon: Wrench, kind: "TRADIE", label: "Tradies" },
];

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
  const openDialer = useCallback(() => setOpen(true), []);
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
        <Phone className="mr-1.5 size-4" aria-hidden="true" />
        Call
      </Button>
      {open ? (
        <ProjectDialer
          projectId={projectId}
          projectName={projectName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ProjectDialer({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const phone = useOptionalPhone();
  const keys = useIdempotencyKeys();
  const [data, setData] = useState<ProjectCallsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"people" | "keypad">("people");
  const [collapsed, setCollapsed] = useState(false);
  const [number, setNumber] = useState("");
  const [placing, setPlacing] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readTarget(),
  );
  const [tones, setTones] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchProjectCalls(projectId));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load the project's people.",
      );
    }
  }, [projectId]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);
  useProjectCallsChange(projectId, load);

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
  const viaPhone =
    target && target !== BROWSER
      ? (options?.phones.find((item) => phoneKey(item) === target) ?? null)
      : null;

  const onCall = phone?.active?.kind === "pstn" ? phone.active : null;
  const inBrowserCall = onCall?.phase === "active";
  const busy = Boolean(phone?.active);

  const typed = normaliseLeadPhone(number);
  const typedContact = typed.usable
    ? data?.contacts.find((contact) => contact.e164 === typed.e164)
    : undefined;

  async function place(
    to: { contactRef: string } | { number: string },
    label: string,
    keyTarget: string,
  ) {
    if (placing || !target) return;
    if (busy) {
      toast.error("Finish the current call first.");
      return;
    }
    const viaBrowser = target === BROWSER;
    if (viaBrowser && phone?.status !== "ready") {
      toast.error(
        phone?.message
          ?? "The browser phone isn't connected yet. Pick a phone to take the call, or wait a moment.",
      );
      return;
    }
    setPlacing(keyTarget);
    try {
      if (viaBrowser) {
        // Before their phone rings: a blocked microphone found now costs
        // nothing; found after they pick up, they hear silence.
        const micProblem = await checkMicrophone();
        if (micProblem) {
          toast.error(micProblem);
          return;
        }
      }
      const result = await placeProjectCall(
        projectId,
        to,
        viaBrowser ? "browser" : "mobile",
        keys.current(keyTarget),
        viaPhone?.id ?? null,
      );
      keys.rotate(keyTarget);
      if (viaBrowser) {
        phone?.expectOutboundCall({
          callId: result.call.id,
          leadName: result.call.contactName ?? label,
        });
      }
      if (result.alreadyPlaced) {
        toast.info("That call was already placed — it wasn't placed again.");
      } else if (!viaBrowser) {
        toast.success(
          `Calling ${label}. ${viaPhone?.nickname ?? "The office mobile"} rings when they answer.`,
        );
      }
      if ("number" in to) setNumber("");
    } catch (placeError) {
      toast.error(
        placeError instanceof Error
          ? placeError.message
          : "The call couldn't be placed.",
      );
    } finally {
      setPlacing(null);
      announceProjectCallsChange(projectId);
    }
  }

  function press(digit: string) {
    if (inBrowserCall && phone?.sendDigits(digit)) {
      setTones((value) => `${value}${digit}`.slice(-24));
      return;
    }
    setNumber((value) => `${value}${digit}`.slice(0, 24));
    input.current?.focus();
  }

  const canCall = Boolean(options?.allowed && target) && !busy;

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

      {collapsed ? null : (
        <div className="flex min-h-0 flex-1 flex-col">
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
              On a call with {onCall?.leadName ?? "the other person"}. The
              keypad sends tones
              {tones ? (
                <span className="ml-1 font-mono tabular-nums">{tones}</span>
              ) : null}
              .
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

            {data && view === "people" ? (
              <PeopleList
                contacts={data.contacts}
                canCall={canCall}
                placing={placing}
                onCall={(contact) =>
                  void place(
                    { contactRef: contact.ref },
                    contact.name,
                    contact.ref,
                  )
                }
              />
            ) : null}

            {data && view === "keypad" ? (
              <div className="space-y-3">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (typed.usable)
                      void place(
                        { number },
                        typedContact?.name ?? formatE164ForDisplay(typed.e164),
                        "keypad",
                      );
                  }}
                >
                  <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2">
                    <input
                      ref={input}
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      aria-label="Number to call"
                      placeholder="Enter a number"
                      value={number}
                      maxLength={24}
                      onChange={(event) =>
                        setNumber(
                          event.target.value.replace(/[^\d+*#\s()-]/g, ""),
                        )
                      }
                      className="h-11 min-w-0 flex-1 bg-transparent text-center font-mono text-lg tabular-nums tracking-wide outline-none placeholder:font-sans placeholder:text-sm placeholder:tracking-normal"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label="Delete the last digit"
                      disabled={!number}
                      onClick={() => setNumber((value) => value.slice(0, -1))}
                    >
                      <Delete className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="mt-1 h-4 truncate text-center text-xs text-muted-foreground">
                    {typedContact
                      ? `${typedContact.name} · ${typedContact.role}`
                      : number && !typed.usable
                        ? "Not a complete number yet"
                        : typed.usable
                          ? formatE164ForDisplay(typed.e164)
                          : ""}
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {KEYS.map((key) => (
                      <button
                        key={key.digit}
                        type="button"
                        onClick={() => press(key.digit)}
                        className="flex h-12 flex-col items-center justify-center rounded-full bg-muted/60 text-foreground transition-colors hover:bg-muted active:bg-muted-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-label={
                          inBrowserCall ? `Send tone ${key.digit}` : key.digit
                        }
                      >
                        <span className="text-lg leading-none font-medium">
                          {key.digit}
                        </span>
                        <span className="h-3 text-[9px] leading-3 tracking-widest text-muted-foreground">
                          {key.letters}
                        </span>
                      </button>
                    ))}
                  </div>
                  <Button
                    type="submit"
                    className="mt-3 h-11 w-full rounded-full bg-success-ink text-white hover:bg-success-ink/90"
                    disabled={!canCall || !typed.usable || placing !== null}
                  >
                    {placing === "keypad" ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Phone className="size-4" aria-hidden="true" />
                    )}
                    Call
                  </Button>
                </form>
              </div>
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
                  onClick={() => void load()}
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
      )}
    </div>
  );
}

function PeopleList({
  contacts,
  canCall,
  placing,
  onCall,
}: {
  contacts: readonly ProjectCallContactDto[];
  canCall: boolean;
  placing: string | null;
  onCall: (contact: ProjectCallContactDto) => void;
}) {
  if (contacts.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nobody on this project has a number yet. Use the keypad to call any
        number.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {GROUPS.map((group) => {
        const people = contacts.filter(
          (contact) => contact.kind === group.kind,
        );
        if (people.length === 0) return null;
        const Icon = group.icon;
        return (
          <section key={group.kind} aria-label={group.label}>
            <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Icon className="size-3.5" aria-hidden="true" />
              {group.label}
            </h3>
            <ul className="divide-y divide-border/60 rounded-lg border border-border">
              {people.map((contact) => (
                <li
                  key={contact.ref}
                  className="flex items-center gap-2 px-2.5 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {contact.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {contact.role}
                      {" · "}
                      {contact.e164 ? (
                        <span className="font-mono tabular-nums">
                          {formatE164ForDisplay(contact.e164)}
                        </span>
                      ) : (
                        <span className="text-warning-ink">
                          {contact.problem}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    className="size-9 shrink-0 rounded-full bg-success-ink text-white hover:bg-success-ink/90"
                    disabled={!canCall || !contact.e164 || placing !== null}
                    aria-label={`Call ${contact.name}`}
                    title={contact.problem ?? `Call ${contact.name}`}
                    onClick={() => onCall(contact)}
                  >
                    {placing === contact.ref ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Phone className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

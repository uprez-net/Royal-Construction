"use client";

import { HardHat, Loader2, Phone, UserRound, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import type {
  ProjectCallContactDto,
  ProjectCallContactKindDto,
} from "@/lib/leads/comms-types";

// The dialer's People view: the project's site manager, owners and connected
// tradies, grouped, each with their number (or why there is none) and a Call
// button.

const GROUPS: readonly {
  kind: ProjectCallContactKindDto;
  label: string;
  icon: React.ElementType;
}[] = [
  { icon: HardHat, kind: "SITE_MANAGER", label: "Site manager" },
  { icon: UserRound, kind: "OWNER", label: "Owners" },
  { icon: Wrench, kind: "TRADIE", label: "Tradies" },
];

export function DialerPeople({
  contacts,
  canCall,
  placingKey,
  busy,
  onCall,
}: {
  contacts: readonly ProjectCallContactDto[];
  canCall: boolean;
  /** The contact `ref` being placed, if any. */
  placingKey: string | null;
  /** Some call is being placed: no second one starts. */
  busy: boolean;
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
                    disabled={!canCall || !contact.e164 || busy}
                    aria-label={`Call ${contact.name}`}
                    title={contact.problem ?? `Call ${contact.name}`}
                    onClick={() => onCall(contact)}
                  >
                    {placingKey === contact.ref ? (
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

"use client";

import { useState } from "react";
import { ChevronDown, Loader2, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatE164ForDisplay } from "@/lib/domain/leads/whatsapp/phone";
import type { CallablePhoneDto } from "@/lib/leads/comms-types";

// "Call via <phone>": rings the lead, then puts them through to the phone
// picked here. The chevron lists every phone on the team list with its
// number. Picking one only selects it — the customer is rung when the main
// button is pressed — and this browser remembers the pick, so whoever sits at
// it gets their own phone by default.

const STORAGE_KEY = "comms:call-via-phone";

/** The office mobile has no id; it needs a key all the same. */
export function phoneKey(phone: Pick<CallablePhoneDto, "id">): string {
  return phone.id ?? "office";
}

function readRemembered(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(key: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Private window or blocked storage: the pick lasts this visit only.
  }
}

export function CallViaPhoneButton({
  phones,
  disabled,
  placing,
  onCall,
}: {
  phones: readonly CallablePhoneDto[];
  disabled: boolean;
  placing: boolean;
  onCall: (phone: CallablePhoneDto) => void;
}) {
  const [picked, setPicked] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readRemembered(),
  );
  // A remembered phone an admin has since removed falls back to the first.
  const selected =
    phones.find((phone) => phoneKey(phone) === picked) ?? phones[0] ?? null;
  if (!selected) return null;

  const icon = placing ? (
    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Smartphone className="size-4" aria-hidden="true" />
  );
  const main = (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => onCall(selected)}
      title={`Rings ${selected.nickname} on ${formatE164ForDisplay(selected.e164)} when the lead answers`}
      className="min-w-0"
    >
      {icon}
      <span className="truncate">Call via {selected.nickname}</span>
    </Button>
  );

  if (phones.length === 1) return main;

  return (
    <ButtonGroup>
      {main}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            aria-label="Choose which phone rings"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Put the lead through to
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={phoneKey(selected)}
            onValueChange={(key) => {
              setPicked(key);
              remember(key);
            }}
          >
            {phones.map((phone) => (
              <DropdownMenuRadioItem
                key={phoneKey(phone)}
                value={phoneKey(phone)}
                className="py-1.5"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{phone.nickname}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatE164ForDisplay(phone.e164)}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}

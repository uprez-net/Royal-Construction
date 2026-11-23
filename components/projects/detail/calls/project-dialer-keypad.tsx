"use client";

import { useRef, useState } from "react";
import { Delete, Loader2, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatE164ForDisplay,
  normaliseLeadPhone,
} from "@/lib/domain/leads/whatsapp/phone";
import type { ProjectCallContactDto } from "@/lib/leads/comms-types";

// The dialer's Keypad view: a number box and a 12-key pad. Before a call the
// keys type the number; during a browser call they send touch-tones instead
// (a supplier's menu, an extension). A typed number that belongs to someone
// on the project says so, and the server files the call as them.

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

export function DialerKeypad({
  contacts,
  canCall,
  placing,
  busy,
  sendTone,
  onCall,
}: {
  contacts: readonly ProjectCallContactDto[];
  canCall: boolean;
  /** A typed number is being placed: the Call button spins. */
  placing: boolean;
  /** Some call is being placed: no second one starts. */
  busy: boolean;
  /** During a browser call: send a tone, true if it went. Null otherwise. */
  sendTone: ((digit: string) => boolean) | null;
  /** Place the call; resolves true when it was placed. */
  onCall: (e164: string, label: string) => Promise<boolean>;
}) {
  const [number, setNumber] = useState("");
  const [tones, setTones] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const typed = normaliseLeadPhone(number);
  const typedContact = typed.usable
    ? contacts.find((contact) => contact.e164 === typed.e164)
    : undefined;

  function press(digit: string) {
    if (sendTone?.(digit)) {
      setTones((value) => `${value}${digit}`.slice(-24));
      return;
    }
    setNumber((value) => `${value}${digit}`.slice(0, 24));
    input.current?.focus();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!typed.usable) return;
        void onCall(
          typed.e164,
          typedContact?.name ?? formatE164ForDisplay(typed.e164),
        ).then((placed) => {
          if (placed) setNumber("");
        });
      }}
    >
      {sendTone && tones ? (
        <p className="mb-2 text-center text-xs text-muted-foreground">
          Tones sent{" "}
          <span className="font-mono tabular-nums text-foreground">
            {tones}
          </span>
        </p>
      ) : null}
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
            setNumber(event.target.value.replace(/[^\d+*#\s()-]/g, ""))
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
            className="flex h-12 flex-col items-center justify-center rounded-full bg-muted/60 text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-muted-foreground/20"
            aria-label={sendTone ? `Send tone ${key.digit}` : key.digit}
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
        disabled={!canCall || !typed.usable || busy}
      >
        {placing ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Phone className="size-4" aria-hidden="true" />
        )}
        Call
      </Button>
    </form>
  );
}

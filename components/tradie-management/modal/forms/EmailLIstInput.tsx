"use client";

import { useState, type KeyboardEvent } from "react";
import { Mail, X } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const emailSchema = z.email();

interface EmailListInputProps {
  /** Used to wire up the visible label, the hidden input, and aria-describedby. */
  id?: string;
  label?: string;
  value: string[];
  onChange: (emails: string[]) => void;
  /** Called when the field loses focus, mirroring the rest of the form's markTouched pattern. */
  onBlur?: () => void;
  placeholder?: string;
  /** Server/schema-level error, e.g. from the parent's zod validation. */
  error?: string;
  disabled?: boolean;
}

/**
 * Chip-style input for collecting a variable list of email addresses
 * (e.g. CreateTradieInput.additionalEmails). Each entry is validated on
 * commit (Enter, comma, or blur) before being added as a removable badge.
 */
export function EmailListInput({
  id = "additional-emails",
  label = "Additional emails",
  value,
  onChange,
  onBlur,
  placeholder = "Add an email and press Enter",
  error,
  disabled,
}: EmailListInputProps) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const commitDraft = () => {
    const candidate = draft.trim().replace(/,$/, "");
    if (!candidate) {
      setDraft("");
      return;
    }

    const result = emailSchema.safeParse(candidate);
    if (!result.success) {
      setLocalError("Enter a valid email address");
      return;
    }
    if (value.some((e) => e.toLowerCase() === candidate.toLowerCase())) {
      setLocalError("That email is already added");
      return;
    }

    onChange([...value, candidate]);
    setDraft("");
    setLocalError(null);
  };

  const removeEmail = (email: string) => {
    onChange(value.filter((e) => e !== email));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      // Backspacing on an empty field pops the last chip, mirroring most
      // tag-input conventions (Gmail, Linear, etc.).
      removeEmail(value[value.length - 1]);
    }
  };

  const shownError = localError || error;
  const describedBy = [shownError ? `${id}-error` : null, `${id}-hint`]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-2">
        <Mail className="h-4 w-4" aria-hidden="true" />
        {label}
      </Label>

      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-sm focus-within:ring-1 focus-within:ring-ring",
          shownError && "border-destructive focus-within:ring-destructive",
        )}
      >
        {value.map((email) => (
          <Badge
            key={email}
            variant="secondary"
            className="gap-1 py-0.5 pl-2 pr-1 font-normal"
          >
            {email}
            <button
              type="button"
              disabled={disabled}
              onClick={() => removeEmail(email)}
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20 disabled:pointer-events-none"
              aria-label={`Remove ${email}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}
        <input
          id={id}
          type="email"
          disabled={disabled}
          value={draft}
          placeholder={value.length === 0 ? placeholder : ""}
          aria-invalid={Boolean(shownError)}
          aria-describedby={describedBy || undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            if (localError) setLocalError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            commitDraft();
            onBlur?.();
          }}
          className="min-w-[10ch] flex-1 border-0 bg-transparent p-0.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {shownError ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {shownError}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Press Enter or comma to add another address.
        </p>
      )}
    </div>
  );
}

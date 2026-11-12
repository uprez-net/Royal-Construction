"use client";

import { useState } from "react";

import { SignaturePad } from "@/components/common/signature-pad";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatDate, rememberedReviewerName } from "./checklist-client";

// The reviewer's name, signature and date, shared by every dialog that signs
// something, and the refusal those dialogs show in place.

// Each dialog's body mounts when it opens, so its fields start fresh every
// time without an effect resetting them.
export function useReviewer() {
  const [name, setName] = useState(() => rememberedReviewerName());
  const [signature, setSignature] = useState<string | null>(null);
  return { name, setName, setSignature, signature };
}

export function ReviewerFields({
  name,
  onName,
  signature,
  onSignature,
  disabled,
  idPrefix,
}: {
  name: string;
  onName: (value: string) => void;
  signature: string | null;
  onSignature: (value: string | null) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-reviewer`}>Reviewer name</Label>
        <Input
          id={`${idPrefix}-reviewer`}
          value={name}
          maxLength={120}
          autoComplete="name"
          disabled={disabled}
          onChange={(event) => onName(event.target.value)}
        />
      </div>
      <SignaturePad
        value={signature}
        onChange={onSignature}
        disabled={disabled}
      />
      <p className="text-sm text-muted-foreground">
        Date:{" "}
        <span className="font-medium text-foreground">
          {formatDate(new Date())}
        </span>{" "}
        (recorded automatically)
      </p>
    </div>
  );
}

export function RefusalAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

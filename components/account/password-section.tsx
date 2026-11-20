"use client";

import { useState, type FormEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

import { clerkErrorMessage, wasReverificationCancelled } from "./clerk-error";
import { useVerifiedAction } from "./reverification";

type UserResource = NonNullable<ReturnType<typeof useUser>["user"]>;

const MIN_LENGTH = 8;

/** Set or change the password. Clerk checks its strength and breach lists. */
export function PasswordSection() {
  const { user } = useUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatePassword = useVerifiedAction(
    (
      target: UserResource,
      params: Parameters<UserResource["updatePassword"]>[0],
    ) => target.updatePassword(params),
  );

  if (!user) return null;
  const hasPassword = user.passwordEnabled;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || saving) return;
    if (next.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePassword(user, {
        currentPassword: hasPassword ? current : undefined,
        newPassword: next,
        signOutOfOtherSessions: signOutOthers,
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(hasPassword ? "Password changed." : "Password set.");
    } catch (submitError) {
      if (!wasReverificationCancelled(submitError)) {
        setError(
          clerkErrorMessage(submitError, "Could not save the password."),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="Password"
      description={
        hasPassword
          ? "Change the password you sign in with."
          : "You don't have a password yet. Set one to sign in with your email and a password."
      }
    >
      <form onSubmit={submit} className="grid max-w-md gap-4">
        {/* Lets a password manager tie the new password to this account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user.primaryEmailAddress?.emailAddress ?? ""}
          readOnly
          hidden
        />
        {hasPassword ? (
          <PasswordField
            id="account-current-password"
            label="Current password"
            autoComplete="current-password"
            value={current}
            onChange={setCurrent}
          />
        ) : null}
        <PasswordField
          id="account-new-password"
          label="New password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          hint={`At least ${MIN_LENGTH} characters.`}
        />
        <PasswordField
          id="account-confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
        />
        <div className="flex items-start gap-2">
          <Checkbox
            id="account-sign-out-others"
            checked={signOutOthers}
            onCheckedChange={(checked) => setSignOutOthers(checked === true)}
          />
          <Label
            htmlFor="account-sign-out-others"
            className="text-sm leading-tight font-normal"
          >
            Sign out of every other device
          </Label>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive-ink">
            {error}
          </p>
        ) : null}
        <div>
          <Button
            type="submit"
            variant="royal"
            disabled={saving || !next || !confirm || (hasPassword && !current)}
          >
            {saving ? <Spinner className="size-4" aria-hidden="true" /> : null}
            {hasPassword ? "Change password" : "Set password"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        <span aria-hidden="true" className="text-destructive-ink">
          *
        </span>
        <span className="sr-only">(required)</span>
      </Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        aria-required="true"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-[0.8125rem] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

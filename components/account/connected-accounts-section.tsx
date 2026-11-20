"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";

import { SectionCard } from "@/components/common/section-card";
import { StatusPill } from "@/components/common/status-pill";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { clerkErrorMessage, wasReverificationCancelled } from "./clerk-error";
import { useVerifiedAction } from "./reverification";

type UserResource = NonNullable<ReturnType<typeof useUser>["user"]>;
type ExternalAccount = UserResource["externalAccounts"][number];

/** Where Google sends the browser back to; the marker says which flow ended. */
function returnUrl(): string {
  return `${window.location.origin}/account?connected=google`;
}

/**
 * Linking Google, so the person can sign in with it. Clerk runs the OAuth
 * round trip; the browser leaves for Google and comes back to this page.
 */
export function ConnectedAccountsSection() {
  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);

  const google = user?.externalAccounts.find(
    (account) => account.provider === "google",
  );
  const linked = google?.verification?.status === "verified";

  // Back from Google: say how it went once, then drop the marker from the URL.
  // The page mounts with the user loaded, so a failed link is known here.
  const returned = searchParams.get("connected") === "google";
  const [error, setError] = useState<string | null>(() =>
    returned && google && !linked
      ? (google.verification?.error?.longMessage
        ?? "Google didn't finish connecting. Try again.")
      : null,
  );
  useEffect(() => {
    if (!returned) return;
    if (linked) toast.success("Google account connected.");
    router.replace("/account", { scroll: false });
  }, [returned, linked, router]);

  const connect = useVerifiedAction((target: UserResource) =>
    target.createExternalAccount({
      redirectUrl: returnUrl(),
      strategy: "oauth_google",
    }),
  );
  const reconnect = useVerifiedAction((account: ExternalAccount) =>
    account.reauthorize({ redirectUrl: returnUrl() }),
  );
  const disconnect = useVerifiedAction((account: ExternalAccount) =>
    account.destroy(),
  );

  if (!user) return null;

  async function startConnect() {
    if (!user) return;
    setBusy("connect");
    setError(null);
    try {
      const account =
        google && !linked ? await reconnect(google) : await connect(user);
      const redirect =
        account.verification?.externalVerificationRedirectURL?.href;
      if (!redirect) {
        throw new Error("Google sign-in isn't available for this account.");
      }
      window.location.assign(redirect);
    } catch (connectError) {
      setBusy(null);
      if (!wasReverificationCancelled(connectError)) {
        setError(
          clerkErrorMessage(connectError, "Could not start connecting Google."),
        );
      }
    }
  }

  async function startDisconnect() {
    if (!google || !user) return;
    setBusy("disconnect");
    setError(null);
    try {
      await disconnect(google);
      await user.reload();
      toast.success("Google account disconnected.");
    } catch (disconnectError) {
      if (!wasReverificationCancelled(disconnectError)) {
        setError(
          clerkErrorMessage(disconnectError, "Could not disconnect Google."),
        );
      }
    } finally {
      setBusy(null);
    }
  }

  // Without a password, Google may be the only way back in.
  const cannotDisconnect = linked && !user.passwordEnabled;

  return (
    <SectionCard
      title="Connected accounts"
      description="Sign in with Google instead of typing a password."
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <GoogleMark />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Google</p>
            <p className="truncate text-[0.8125rem] text-muted-foreground">
              {linked
                ? google?.emailAddress
                : google
                  ? "Not finished connecting"
                  : "Not connected"}
            </p>
          </div>
          {linked ? <StatusPill tone="success">Connected</StatusPill> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {linked ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void startDisconnect()}
              disabled={busy !== null || cannotDisconnect}
            >
              {busy === "disconnect" ? (
                <Spinner className="size-3.5" aria-hidden="true" />
              ) : null}
              Disconnect
            </Button>
          ) : (
            <>
              {google ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void startDisconnect()}
                  disabled={busy !== null}
                >
                  Remove
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void startConnect()}
                disabled={busy !== null}
              >
                {busy === "connect" ? (
                  <Spinner className="size-3.5" aria-hidden="true" />
                ) : null}
                {google ? "Try again" : "Connect Google"}
              </Button>
            </>
          )}
        </div>
      </div>
      {cannotDisconnect ? (
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          Set a password before disconnecting Google, so you can still sign in.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive-ink">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}

function GoogleMark() {
  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card"
    >
      <svg viewBox="0 0 24 24" className="size-5">
        <path
          fill="#4285F4"
          d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38l4-3.1Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
        />
      </svg>
    </span>
  );
}

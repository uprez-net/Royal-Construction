"use client";

import { useUser } from "@clerk/nextjs";

import { Skeleton } from "@/components/ui/skeleton";

import { ConnectedAccountsSection } from "./connected-accounts-section";
import { PasswordSection } from "./password-section";
import { PhoneSection } from "./phone-section";
import { ProfileSection } from "./profile-section";
import { ReverificationProvider } from "./reverification";
import { SessionsSection } from "./sessions-section";

/**
 * The signed-in person's own account. Clerk holds the picture, name,
 * password, Google link and devices, reached through its client SDK; the phone
 * number lives on the app's own user record. No Clerk UI is mounted.
 */
export function AccountProfile() {
  const { isLoaded, user } = useUser();

  if (!isLoaded) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <ReverificationProvider>
      <div className="grid gap-6">
        {/* Keyed on the user so the name form starts from Clerk's values. */}
        <ProfileSection key={user.id} />
        <PhoneSection />
        <PasswordSection />
        <ConnectedAccountsSection />
        <SessionsSection />
      </div>
    </ReverificationProvider>
  );
}

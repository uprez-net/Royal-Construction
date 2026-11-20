import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountProfile } from "@/components/account/account-profile";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = {
  title: "Profile & account",
  description:
    "Your name, picture, phone number, password, Google sign-in and signed-in devices.",
};

export default function AccountPage() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader
        title="Profile & account"
        headingLevel="h1"
        description="Your details, how you sign in, and where you're signed in."
      />
      {/* useSearchParams (back from Google) needs a boundary under Cache Components. */}
      <Suspense fallback={null}>
        <AccountProfile />
      </Suspense>
    </div>
  );
}

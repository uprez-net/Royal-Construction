import { Suspense } from "react";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { Button } from "../ui/button";
import Link from "next/link";

async function AuthContent() {
  const user = await auth();

  if (!user.isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="rounded-2xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white"
          asChild
        >
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button
          className="rounded-2xl bg-teal-500 text-slate-950 hover:bg-teal-400"
          asChild
        >
          <Link href="/sign-up">Sign up</Link>
        </Button>
      </div>
    );
  }

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: "size-9",
        },
      }}
    />
  );
}

function AuthFallback() {
  return <div className="size-9 rounded-full bg-muted animate-pulse" />;
}

export function AuthButton() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <AuthContent />
    </Suspense>
  );
}

"use client";

import Link from "next/link";
import { useClerk, useUser } from "@clerk/nextjs";
import { ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { UserAvatar } from "./user-avatar";

/**
 * The signed-in person's menu: who they are, their profile page, and sign
 * out. Replaces Clerk's `UserButton`, so the account screens are the app's
 * own rather than Clerk's modal.
 *
 * `sidebar` is the full-width row at the foot of the mobile navigation sheet;
 * `header` is the avatar button in the top bar.
 */
export function AccountMenu({
  variant,
  onNavigate,
}: {
  variant: "sidebar" | "header";
  /** Called when an item navigates, so the mobile sheet can close. */
  onNavigate?: () => void;
}) {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  if (!isLoaded || !user) {
    return variant === "sidebar" ? (
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="h-4 w-28" />
      </div>
    ) : (
      <Skeleton className="size-9 rounded-full" />
    );
  }

  const email = user.primaryEmailAddress?.emailAddress ?? "";
  const name = user.fullName?.trim() || email;
  const avatar = (
    <UserAvatar
      imageUrl={user.imageUrl}
      hasImage={user.hasImage}
      name={user.fullName}
      email={email}
    />
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${name}`}
        className={cn(
          "rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          variant === "sidebar"
            && "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sidebar-foreground transition-colors hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent",
        )}
      >
        {avatar}
        {variant === "sidebar" ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {name}
              </span>
              {email && email !== name ? (
                <span className="block truncate text-xs text-sidebar-foreground/70">
                  {email}
                </span>
              ) : null}
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 text-sidebar-foreground/70"
              aria-hidden="true"
            />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
        className="w-64"
      >
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          {avatar}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">
              {name}
            </span>
            {email && email !== name ? (
              <span className="block truncate text-xs text-muted-foreground">
                {email}
              </span>
            ) : null}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/account" onClick={onNavigate}>
              <UserRound aria-hidden="true" />
              Profile &amp; account
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            setSigningOut(true);
            void signOut({ redirectUrl: "/sign-in" }).catch(() =>
              setSigningOut(false),
            );
          }}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

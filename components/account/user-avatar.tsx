"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Up to two initials from a name, or from an email when there is no name. */
export function initialsFor(name: string | null | undefined, email?: string) {
  const source = name?.trim() || email?.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || "?";
}

/**
 * The person's picture, or their initials. Clerk serves a generated image even
 * when nobody uploaded one, so `hasImage` decides which to show.
 */
export function UserAvatar({
  imageUrl,
  hasImage,
  name,
  email,
  className,
}: {
  imageUrl?: string | null;
  hasImage?: boolean;
  name?: string | null;
  email?: string;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-9", className)}>
      {hasImage && imageUrl ? (
        <AvatarImage src={imageUrl} alt="" className="object-cover" />
      ) : null}
      <AvatarFallback className="bg-royal-gold-light text-[0.75rem] font-semibold text-royal-gold-ink-text">
        {initialsFor(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}

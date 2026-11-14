import { cn } from "@/lib/utils";

import { WHATSAPP_GLYPH_PATH } from "./whatsapp-glyph-path";

/** WhatsApp's brand green, and the darker teal its light theme uses. */
export const WHATSAPP_GREEN = "#25D366";
export const WHATSAPP_TEAL = "#008069";

/**
 * The WhatsApp glyph.
 *
 * `currentColor` by default, so it takes the text colour it sits in; pass
 * `brand` for WhatsApp green. Decorative unless given a `title`.
 */
export function WhatsAppGlyph({
  className,
  brand = false,
  title,
}: {
  className?: string;
  brand?: boolean;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4 shrink-0", className)}
      fill={brand ? WHATSAPP_GREEN : "currentColor"}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path d={WHATSAPP_GLYPH_PATH} />
    </svg>
  );
}

/** The glyph in a green disc, as WhatsApp shows its own app icon. */
export function WhatsAppBadgeIcon({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-white",
        className,
      )}
      style={{ backgroundColor: WHATSAPP_GREEN }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <WhatsAppGlyph className="size-[58%]" />
    </span>
  );
}

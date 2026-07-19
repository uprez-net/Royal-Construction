// Proposal image slots. Each offer stores a URL per slot (Vercel Blob). Missing
// slots render as on-layout placeholders in the print template. The hero + the
// six gallery slots mirror the pages of the building proposal.

export type OfferImageSlotKey =
  | "hero"
  | "exterior"
  | "render"
  | "kitchen"
  | "living"
  | "bedroom"
  | "bathroom";

// How an image was obtained. Drives honest captioning: "ai" images are never
// presented as real completed work — they carry an indicative-concept label.
export type OfferImageSource = "upload" | "dropbox" | "ai";

export type OfferImage = {
  readonly url: string;
  readonly source: OfferImageSource;
};

export type OfferImageMap = Partial<Record<OfferImageSlotKey, OfferImage>>;

export type OfferImageSlot = {
  readonly key: OfferImageSlotKey;
  readonly label: string;
  readonly caption: string;
};

export const OFFER_IMAGE_SLOTS: readonly OfferImageSlot[] = [
  { key: "hero", label: "Hero — completed home / render", caption: "Cover image" },
  { key: "exterior", label: "Exterior — full render facade", caption: "Completed facade" },
  { key: "render", label: "3D perspective — render", caption: "Architect render" },
  { key: "kitchen", label: "Kitchen & butler's pantry", caption: "Shaker kitchen, stone island" },
  { key: "living", label: "Living & open plan", caption: "Herringbone flooring" },
  { key: "bedroom", label: "Master bedroom & ensuite", caption: "Freestanding bath, FTC tiles" },
  { key: "bathroom", label: "Second bathroom", caption: "Stone vanity, arched mirrors" },
];

export const EMPTY_OFFER_IMAGES: OfferImageMap = {};

export function setOfferImage(
  images: OfferImageMap,
  key: OfferImageSlotKey,
  image: OfferImage | null,
): OfferImageMap {
  const next = { ...images };
  if (image) {
    next[key] = image;
  } else {
    delete next[key];
  }
  return next;
}

// Human-readable caption suffix for a slot, honest about AI-generated concepts.
export function offerImageCaption(base: string, source?: OfferImageSource): string {
  return source === "ai" ? `${base} — AI concept, indicative only` : base;
}

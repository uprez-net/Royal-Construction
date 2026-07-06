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

export type OfferImageMap = Partial<Record<OfferImageSlotKey, string>>;

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
  url: string | null,
): OfferImageMap {
  const next = { ...images };
  if (url) {
    next[key] = url;
  } else {
    delete next[key];
  }
  return next;
}

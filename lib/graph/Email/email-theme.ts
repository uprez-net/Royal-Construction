/** Royal Constructions email brand tokens — aligned with royalconstructions.com.au */

export const RC_SITE = "https://royalconstructions.com.au";
export const RC_MAIN_APP = "https://royal-construction-chi.vercel.app";

/**
 * Client-document palette, DESIGN.md §5. Charcoal on white, warm neutrals.
 * `gold` is the gold-ink #926100: text, links, buttons and indicators all
 * read against white (5.34:1). The brand gold #c6923a is `brandGold`, and it
 * is only the letterhead bar, the footer rule and table-header underlines:
 * as text it measures 2.77:1, and it never carries white text.
 */
export const RC_COLORS = {
  dark: "#F1EFE9",
  container: "#F7F6F2",
  card: "#FFFFFF",
  border: "#E6E2D9",
  footer: "#F1EFE9",
  gold: "#926100",
  brandGold: "#C6923A",
  goldWash: "#FBF6EC",
  white: "#FFFFFF",
  text: "#343434",
  muted: "#6B675F",
  dimmed: "#6B675F",
  light: "#F7F6F2",
  label: "#6B675F",
  highlight: "#F1EFE9",
  ctaText: "#343434",
  accreditedLabel: "#6B675F",
  textOnLight: "#343434",
  textMutedOnLight: "#6B675F",
} as const;

export const RC_URLS = {
  website: `${RC_SITE}/`,
  customHomes: `${RC_SITE}/custom-homes/`,
  projects: `${RC_SITE}/projects/`,
  quotation: `${RC_MAIN_APP}/quotation/`,
  /** PNG for broad email client support (WebP often fails in Gmail/Outlook). */
  logo: `${RC_SITE}/wp-content/uploads/2026/03/logo-1024x713.png`,
  mbaLogo: `${RC_SITE}/wp-content/uploads/2026/03/image-78.png`,
  oranPark: `${RC_SITE}/wp-content/uploads/2026/03/Horizontal-secondary-lockup-1.png`,
  /** Custom-homes hero — clean build photo (not project-card UI with bed/bath strip). */
  heroDefault: `${RC_SITE}/wp-content/uploads/2026/04/royal-contructions-custom-home-build-scaled-e1776813250892.jpg`,
  heroPortfolio: `${RC_SITE}/wp-content/smush-webp/2026/04/CUSTOM-DESIGN_CUSTOM_DUAL-OCCUPANCY_FINAL_V2-1024x683.jpg.webp`,
  contact: `${RC_SITE}/contact/`,
  bookConsultation: `${RC_MAIN_APP}/book-consultation/`,
  privacy: `${RC_SITE}/privacy-policy/`,
  claimOffer: `${RC_SITE}/claim-offer/`,
  terms: `${RC_SITE}/terms/`,
  catalogue: `${RC_SITE}/catalogue/`,
  facebookPage: "https://www.facebook.com/royalconstructionsau/",
  instagramPage: "https://www.instagram.com/royalconstructionsau/",
  phone: "1300832355",
  phoneDisplay: "1300 832 355",
  email: "info@royalconstructions.com.au",
} as const;

/** Logo intrinsic ratio 1024×713 — keep width/height paired for email clients. */
export const LOGO_EMAIL = {
  width: 152,
  height: 106,
} as const;

export function getAppAssetUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")
    ?? "http://localhost:3000";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export const RC_URLS_APP = {
  /**
   * Hosted in Vercel Blob because the local public PDF was removed.
   * Keep this URL in sync with the uploaded asset.
   */
  builderProfile:
    "https://udafiztdzg1cn8u2.public.blob.vercel-storage.com/public-file/Royal_Constructions_Builder_Profile_1.pdf",
} as const;

/**
 * DESIGN.md §5: email clients may not load web fonts, so every stack falls back.
 * Names are single-quoted so a stack can sit inside a double-quoted style="".
 */
export const FONTS = {
  /** Headings. Georgia stands in for Fraunces, which email clients do not load. */
  heading: "Georgia, 'Times New Roman', serif",
  /** Small uppercase labels and button text. */
  label: "Manrope, 'Segoe UI', Helvetica, Arial, sans-serif",
  body: "Manrope, 'Segoe UI', Helvetica, Arial, sans-serif",
  /** Money, dates and reference codes. */
  mono: "'IBM Plex Mono', Menlo, Consolas, monospace",
} as const;

export const RESPONSIVE_CSS = `
@media (max-width:600px) {
  .mobile_max-w-full { max-width: 100% !important; }
  .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
  .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
  .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
  .mobile_pt-10 { padding-top: 2.5rem !important; }
  .mobile_pb-8 { padding-bottom: 2rem !important; }
  .mobile_pb-10 { padding-bottom: 2.5rem !important; }
  .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
  .mobile_font-40 { font-size: 34px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
  .mobile_font-56 { font-size: 40px !important; line-height: 1 !important; }
  .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
  .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
  .mobile_offer_stack { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; padding-bottom: 1rem !important; }
  .mobile_offer_last { padding-bottom: 0 !important; }
}`;

export const FONT_FACES_CSS = `
@font-face {
  font-family: 'Manrope'; font-style: normal; font-weight: 400;
  mso-font-alt: 'Arial';
  src: url(https://fonts.gstatic.com/s/manrope/v23/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk79FN_C-b8.woff) format('woff');
}
@font-face {
  font-family: 'Manrope'; font-style: normal; font-weight: 500;
  mso-font-alt: 'Arial';
  src: url(https://fonts.gstatic.com/s/manrope/v23/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk7PFN_C-b8.woff) format('woff');
}
@font-face {
  font-family: 'Manrope'; font-style: normal; font-weight: 600;
  mso-font-alt: 'Arial';
  src: url(https://fonts.gstatic.com/s/manrope/v23/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4jE9_C-b8.woff) format('woff');
}`;

export const TAILWIND_CONFIG = {
  theme: {
    extend: {
      colors: {
        rc: RC_COLORS,
      },
    },
  },
};

/** Royal Constructions email brand tokens — aligned with royalconstructions.com.au */

export const RC_SITE = 'https://royalconstructions.com.au';
export const RC_MAIN_APP = 'https://royal-construction-chi.vercel.app';

export const RC_COLORS = {
  dark: '#070E1A',
  container: '#0C1829',
  card: '#0F1E33',
  border: '#1A2A42',
  footer: '#091320',
  gold: '#C6923A',
  goldLight: '#D4A034',
  white: '#FFFFFF',
  text: '#B8C4D6',
  muted: '#8A9BB5',
  dimmed: '#3A4E68',
  light: '#F7F6F2',
  label: '#6B7F9E',
  highlight: '#D0DAE8',
  ctaText: '#0C1829',
  accreditedLabel: '#1A2A42',
  textOnLight: '#0C1829',
  textMutedOnLight: '#475569',
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
  facebookPage: 'https://www.facebook.com/royalconstructionsau/',
  instagramPage: 'https://www.instagram.com/royalconstructionsau/',
  phone: '1300832355',
  phoneDisplay: '1300 832 355',
  email: 'info@royalconstructions.com.au',
} as const;

/** Logo intrinsic ratio 1024×713 — keep width/height paired for email clients. */
export const LOGO_EMAIL = {
  width: 152,
  height: 106,
} as const;

export function getAppAssetUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    'http://localhost:3000';
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export const RC_URLS_APP = {
  builderProfile: getAppAssetUrl('/Royal_Constructions_Builder_Profile_1.pdf'),
} as const;

export const FONTS = {
  condensed: '"IBM Plex Sans Condensed", "Arial Narrow", Arial, sans-serif',
  body: 'Inter, Arial, sans-serif',
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
  font-family: 'IBM Plex Sans Condensed'; font-style: normal; font-weight: 500;
  mso-font-alt: 'Arial';
  src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype');
}
@font-face {
  font-family: 'Inter'; font-style: normal; font-weight: 300;
  mso-font-alt: 'Arial';
  src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype');
}
@font-face {
  font-family: 'Inter'; font-style: normal; font-weight: 400;
  mso-font-alt: 'Arial';
  src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2');
}
@font-face {
  font-family: 'Inter'; font-style: normal; font-weight: 500;
  mso-font-alt: 'Arial';
  src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype');
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

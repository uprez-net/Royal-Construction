// @ts-nocheck
import {
      Html,
      Head,
      Body,
      Container,
      Section,
      Row,
      Column,
      Text,
      Link,
      Img,
      Tailwind,
} from "@react-email/components";

// ─── Constants ──────────────────────────────────────────────────────────────

const FONTS = {
      condensed: '"IBM Plex Sans Condensed", "Arial Narrow", Arial, sans-serif',
      body: "Inter, Arial, sans-serif",
};

const URLS = {
      logo: "https://royal-construction-chi.vercel.app/logo-1024x713.png",
      facebook: "https://royal-construction-chi.vercel.app/facebook.svg",
      instagram: "https://royal-construction-chi.vercel.app/instagram.svg",
      mbaLogo: "https://royal-construction-chi.vercel.app/image-78.png",
      oranPark:
            "https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp",
      website: "https://royalconstructions.com.au/",
      portal: "https://royalconstructions.com.au/portal/",
      facebookPage: "https://www.facebook.com/royalconstructionsau/",
      instagramPage: "https://www.instagram.com/royalconstructionsau/",
};

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
      checkDark: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E`,
      checkDarkSmall: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E`,
      checkGoldSmall: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E`,
      calendar: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E`,
      camera: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'%3E%3C/path%3E%3Ccircle cx='12' cy='13' r='4'%3E%3C/circle%3E%3C/svg%3E`,
};

// ─── Responsive + Font Styles ───────────────────────────────────────────────

const RESPONSIVE_CSS = `
@media (max-width:600px) {
  .mobile_max-w-full { max-width: 100% !important; }
  .mobile_px-4 { padding-left: 1rem !important; padding-right: 1rem !important; }
  .mobile_py-8 { padding-top: 2rem !important; padding-bottom: 2rem !important; }
  .mobile_py-12 { padding-top: 3rem !important; padding-bottom: 3rem !important; }
  .mobile_pt-10 { padding-top: 2.5rem !important; }
  .mobile_pb-8 { padding-bottom: 2rem !important; }
  .mobile_pb-10 { padding-bottom: 2.5rem !important; }
  .mobile_font-24 { font-size: 24px !important; line-height: 1.3 !important; letter-spacing: -0.05px !important; }
  .mobile_font-40 { font-size: 30px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
  .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
  .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
  .mobile_progress_full { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; text-align: left !important; padding-bottom: 0.5rem !important; }
  .mobile_progress_last { padding-bottom: 0 !important; }
}`;

const FONT_FACES_CSS = `
@font-face { font-family: 'IBM Plex Sans Condensed'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
`;

// ─── Sub-Components ─────────────────────────────────────────────────────────

function ProgressStep({
      label,
      state,
      mobileClass = "",
}: {
      label: string;
      state: "completed" | "current" | "upcoming";
      mobileClass?: string;
}) {
      const isCompleted = state === "completed";
      const isCurrent = state === "current";

      return (
            <Column
                  className={`mobile_progress_full mobile_progress_last ${mobileClass}`}
                  style={{ width: "25%", verticalAlign: "top", textAlign: "center" }}
            >
                  <Section className="mx-auto" style={{ display: "inline-block" }}>
                        <Row>
                              <Column
                                    style={{
                                          width: 24,
                                          height: 24,
                                          borderRadius: "50%",
                                          textAlign: "center",
                                          verticalAlign: "middle",
                                          backgroundColor: isCompleted ? "#C9A84C" : "#0C1829",
                                          border: isCompleted ? "none" : `2px solid ${isCurrent ? "#C9A84C" : "#1A2A42"}`,
                                    }}
                              >
                                    {isCompleted ? (
                                          <Img alt="" height={12} src={ICONS.checkGoldSmall} width={12} className="block outline-none border-none mx-auto" />
                                    ) : (
                                          <Section className="mx-auto" style={{ display: "inline-block" }}>
                                                <Row>
                                                      <Column
                                                            style={{
                                                                  width: 8,
                                                                  height: 8,
                                                                  borderRadius: "50%",
                                                                  backgroundColor: isCurrent ? "#C9A84C" : "#1A2A42",
                                                                  fontSize: 0,
                                                                  lineHeight: 0,
                                                            }}
                                                      />
                                                </Row>
                                          </Section>
                                    )}
                              </Column>
                        </Row>
                  </Section>
                  <Text
                        className="m-0 mt-2 uppercase text-[11px] leading-tight"
                        style={{
                              fontFamily: FONTS.condensed,
                              fontWeight: 500,
                              color: isCompleted ? "#C9A84C" : isCurrent ? "#FFFFFF" : "#6B7F9E",
                        }}
                  >
                        {label}
                  </Text>
            </Column>
      );
}

function Footer() {
      return (
            <Section className="border-t border-rc-border bg-rc-footer">
                  <Row>
                        <Column
                              className="mobile_px-4 mobile_py-12"
                              style={{ padding: "3rem 1.5rem" }}
                        >
                              <Row>
                                    {/* ── Left Column ── */}
                                    <Column
                                          className="mobile_footer_left"
                                          width="55%"
                                          style={{
                                                verticalAlign: "top",
                                                paddingRight: "2rem",
                                          }}
                                    >
                                          {/* Footer Logo */}
                                          <Section className="bg-rc-light rounded-md mb-5">
                                                <Row>
                                                      <Column className="py-3 px-4">
                                                            <Link
                                                                  href={URLS.website}
                                                                  target="_blank"
                                                                  className="no-underline"
                                                            >
                                                                  <Img
                                                                        alt="Royal Constructions"
                                                                        src={URLS.logo}
                                                                        width={110}
                                                                        className="block outline-none border-none no-underline h-auto"
                                                                  />
                                                            </Link>
                                                      </Column>
                                                </Row>
                                          </Section>

                                          <Text
                                                className="text-rc-muted m-0 mb-6 text-[13px] leading-relaxed tracking-[0.2px]"
                                                style={{
                                                      fontFamily: FONTS.body,
                                                      fontWeight: 300,
                                                      maxWidth: 280,
                                                }}
                                          >
                                                Royal Constructions — Building exceptional homes across
                                                NSW with quality craftsmanship and attention to detail.
                                          </Text>

                                          {/* Social Icons */}
                                          <table
                                                align="left"
                                                width="100%"
                                                border={0}
                                                cellPadding="0"
                                                cellSpacing="0"
                                                role="presentation"
                                                style={{ marginBottom: '1.5rem' }}
                                          >
                                                <tbody>
                                                      <tr>
                                                            <td>
                                                                  <table
                                                                        align="left"
                                                                        width="50%"
                                                                        border={0}
                                                                        cellPadding="0"
                                                                        cellSpacing="0"
                                                                        role="presentation"
                                                                  >
                                                                        <tbody style={{ width: '100%' }}>
                                                                              <tr style={{ width: '100%' }}>
                                                                                    <td style={{ paddingRight: '1rem' }}>
                                                                                          <Link
                                                                                                href={URLS.facebookPage}
                                                                                                target="_blank"
                                                                                                style={{ color: '#067df7', textDecorationLine: 'none', display: 'inline-block' }}
                                                                                          >
                                                                                                <Img
                                                                                                      alt="Facebook"
                                                                                                      height={24}
                                                                                                      src={URLS.facebook}
                                                                                                      width={24}
                                                                                                      style={{ display: 'block', outline: 'none', border: 'none', textDecoration: 'none', outlineStyle: 'none', borderStyle: 'none' }}
                                                                                                />
                                                                                          </Link>
                                                                                    </td>
                                                                                    <td>
                                                                                          <Link
                                                                                                href={URLS.instagramPage}
                                                                                                target="_blank"
                                                                                                style={{ color: '#067df7', textDecorationLine: 'none', display: 'inline-block' }}
                                                                                          >
                                                                                                <Img
                                                                                                      alt="Instagram"
                                                                                                      height={24}
                                                                                                      src={URLS.instagram}
                                                                                                      width={24}
                                                                                                      style={{ display: 'block', outline: 'none', border: 'none', textDecoration: 'none', outlineStyle: 'none', borderStyle: 'none' }}
                                                                                                />
                                                                                          </Link>
                                                                                    </td>
                                                                              </tr>
                                                                        </tbody>
                                                                  </table>
                                                            </td>
                                                      </tr>
                                                </tbody>
                                          </table>

                                          {/* Office */}
                                          <Text
                                                className="text-rc-muted m-0 mb-4 text-[11px] leading-relaxed tracking-[0.3px]"
                                                style={{ fontFamily: FONTS.body, fontWeight: 300 }}
                                          >
                                                <span className="text-rc-white" style={{ fontWeight: 450 }}>
                                                      Office
                                                </span>
                                                <br />
                                                38/62 Turner RD
                                                <br />
                                                Smeaton Grange, NSW 2567
                                          </Text>

                                          {/* Contact */}
                                          <Text
                                                className="text-rc-muted m-0 mb-5 text-[11px] leading-relaxed tracking-[0.3px]"
                                                style={{ fontFamily: FONTS.body, fontWeight: 300 }}
                                          >
                                                <span className="text-rc-white" style={{ fontWeight: 450 }}>
                                                      Contact
                                                </span>
                                                <br />
                                                <Link
                                                      href="tel:1300832355"
                                                      className="text-rc-muted no-underline"
                                                >
                                                      1300 832 355
                                                </Link>
                                                <br />
                                                <Link
                                                      href="mailto:info@royalconstructions.com.au"
                                                      className="text-rc-muted no-underline"
                                                >
                                                      info@royalconstructions.com.au
                                                </Link>
                                          </Text>

                                          {/* Unsubscribe */}
                                          <Text
                                                className="text-rc-dimmed m-0 text-[11px] leading-relaxed tracking-[0.3px]"
                                                style={{ fontFamily: FONTS.body, fontWeight: 300 }}
                                          >
                                                <Link
                                                      href="#"
                                                      className="text-rc-dimmed no-underline"
                                                >
                                                      Unsubscribe
                                                </Link>{" "}
                                                from Royal Constructions marketing emails.
                                          </Text>
                                    </Column>

                                    {/* ── Right Column — Accredited By ── */}
                                    <Column
                                          className="mobile_footer_right"
                                          width="45%"
                                          style={{
                                                verticalAlign: "top",
                                                paddingLeft: "0.5rem",
                                          }}
                                    >
                                          <Section className="bg-rc-light rounded-md">
                                                <Row>
                                                      <Column className="p-5">
                                                            <Text
                                                                  className="text-[#1A2A42] m-0 mb-4 text-[10px] leading-relaxed tracking-[0.8px] uppercase"
                                                                  style={{ fontFamily: FONTS.body, fontWeight: 500 }}
                                                            >
                                                                  Accredited by
                                                            </Text>

                                                            <Link
                                                                  href={URLS.website}
                                                                  target="_blank"
                                                                  className="no-underline"
                                                            >
                                                                  <Img
                                                                        alt="Master Builders Association"
                                                                        src={URLS.mbaLogo}
                                                                        width={100}
                                                                        className="block outline-none border-none no-underline h-auto mb-4"
                                                                  />
                                                            </Link>

                                                            <Link
                                                                  href={URLS.website}
                                                                  target="_blank"
                                                                  className="no-underline"
                                                            >
                                                                  <Img
                                                                        alt="Oran Park"
                                                                        src={URLS.oranPark}
                                                                        width={120}
                                                                        className="block outline-none border-none no-underline h-auto"
                                                                  />
                                                            </Link>
                                                      </Column>
                                                </Row>
                                          </Section>
                                    </Column>
                              </Row>
                        </Column>
                  </Row>
            </Section>
      );
}

// ─── Main Component ─────────────────────────────────────────────────────────

const DEFAULT_STEPS = [
      { label: "Foundation", state: "completed" as const },
      { label: "Frame", state: "completed" as const },
      { label: "Lock-Up", state: "current" as const },
      { label: "Handover", state: "upcoming" as const },
];

interface ProjectUpdateEmailProps {
      name?: string;
      location?: string;
      milestone?: string;
      date?: string;
      progressPercent?: number;
      steps?: { label: string; state: "completed" | "current" | "upcoming" }[];
      nextMilestone?: string;
      portalUrl?: string;
}

export default function ProjectUpdateEmail({
      name = "Client",
      location = "Your Location",
      milestone = "Lock-Up Stage",
      date = "Today",
      progressPercent = 60,
      steps = DEFAULT_STEPS,
      nextMilestone = "Practical Completion",
      portalUrl = URLS.portal,
}: ProjectUpdateEmailProps) {
      const filledWidth = `${Math.min(Math.max(progressPercent, 0), 100)}%`;
      const emptyWidth = `${100 - Math.min(Math.max(progressPercent, 0), 100)}%`;

      return (
            <Tailwind
                  config={{
                        theme: {
                              extend: {
                                    colors: {
                                          rc: {
                                                dark: "#070E1A",
                                                container: "#0C1829",
                                                card: "#0F1E33",
                                                border: "#1A2A42",
                                                footer: "#0A1525",
                                                gold: "#C9A84C",
                                                white: "#FFFFFF",
                                                text: "#B8C4D6",
                                                muted: "#8A9BB5",
                                                dimmed: "#3D5070",
                                                light: "#F5F6F8",
                                                label: "#6B7F9E",
                                          },
                                    },
                              },
                        },
                  }}
            >
                  <Html lang="en" dir="ltr">
                        <Head>
                              <meta content="text/html; charset=UTF-8" httpEquiv="Content-Type" />
                              <meta name="x-apple-disable-message-reformatting" />
                              <style>{RESPONSIVE_CSS}</style>
                              <style>{FONT_FACES_CSS}</style>
                        </Head>

                        <Body className="bg-rc-dark m-0 p-0 text-sm leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 350 }}>
                              {/* Preheader */}
                              <div className="hidden overflow-hidden leading-none opacity-none max-h-0 max-w-0">
                                    Great news — your project has reached an important milestone
                                    <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
                              </div>

                              <Container className="max-w-[640px] bg-rc-container mx-auto">

                                    {/* ── Header ── */}
                                    <Section className="bg-rc-light">
                                          <Row>
                                                <Column className="py-5 px-6">
                                                      <Link href={URLS.website} target="_blank" className="no-underline">
                                                            <Img alt="Royal Constructions" src={URLS.logo} width={140} className="block outline-none border-none h-auto" />
                                                      </Link>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Celebration Banner ── */}
                                    <Section className="bg-rc-gold py-2.5 px-6">
                                          <Row>
                                                <Column className="text-center">
                                                      <Section className="mx-auto" style={{ display: "inline-block" }}>
                                                            <Row>
                                                                  <Column className="pr-2" verticalAlign="middle">
                                                                        <Img alt="" height={16} src={ICONS.checkDarkSmall} width={16} className="block outline-none border-none" />
                                                                  </Column>
                                                                  <Column verticalAlign="middle">
                                                                        <Text
                                                                              className="m-0 uppercase tracking-[1px]"
                                                                              style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 12, lineHeight: 1, color: "#0C1829" }}
                                                                        >
                                                                              Milestone Achieved
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Hero ── */}
                                    <Section className="mobile_px-4 mobile_pt-10" style={{ padding: "3rem 1.5rem 1.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text className="text-rc-gold m-0 mb-4 text-[11px] leading-none tracking-[1.2px] uppercase" style={{ fontFamily: FONTS.body, fontWeight: 500 }}>
                                                            Project Update
                                                      </Text>
                                                      <Text className="mobile_font-40 text-rc-white m-0 uppercase" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 48, lineHeight: 1, letterSpacing: "-1.4px" }}>
                                                            Another Step<br />Complete
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Intro ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0.5rem 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text className="text-rc-text m-0 mb-5" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px" }}>
                                                            Dear {name},
                                                      </Text>
                                                      <Text className="mobile_max-w-full text-rc-text m-0" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px", maxWidth: 480 }}>
                                                            Great news! Your project at{" "}
                                                            <span className="text-rc-white" style={{ fontWeight: 450 }}>{location}</span>{" "}
                                                            has reached an important milestone. Here's a summary of the progress.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Milestone Card ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded-md overflow-hidden" style={{ border: "1px solid #1A2A42" }}>

                                                      {/* Card Header */}
                                                      <Row>
                                                            <Column className="bg-rc-gold py-3.5 px-6">
                                                                  <Text className="text-rc-container m-0 uppercase text-[13px] leading-none tracking-[0.6px]" style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}>
                                                                        Milestone Completed
                                                                  </Text>
                                                            </Column>
                                                      </Row>

                                                      {/* Milestone Name */}
                                                      <Row className="border-b border-rc-border">
                                                            <Column className="pt-7 pb-5 px-6">
                                                                  <Row>
                                                                        <Column className="pt-1" style={{ width: 40 }} verticalAlign="top">
                                                                              <Section className="bg-rc-gold rounded-full" style={{ width: 28, height: 28 }}>
                                                                                    <Row>
                                                                                          <Column style={{ textAlign: "center", verticalAlign: "middle", height: 28 }}>
                                                                                                <Img alt="" height={14} src={ICONS.checkGoldSmall} width={14} className="block outline-none border-none mx-auto" />
                                                                                          </Column>
                                                                                    </Row>
                                                                              </Section>
                                                                        </Column>
                                                                        <Column className="pl-3">
                                                                              <Text className="text-rc-label m-0 mb-1.5 uppercase text-xs leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                                                                                    Milestone
                                                                              </Text>
                                                                              <Text className="m-0" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 22, lineHeight: 1.2, color: "#FFFFFF" }}>
                                                                                    {milestone}
                                                                              </Text>
                                                                        </Column>
                                                                  </Row>
                                                            </Column>
                                                      </Row>

                                                      {/* Completion Date */}
                                                      <Row>
                                                            <Column className="py-5 px-6">
                                                                  <Row>
                                                                        <Column className="pt-[2px]" style={{ width: 40 }} verticalAlign="top">
                                                                              <Img alt="" height={20} src={ICONS.calendar} width={20} className="block outline-none border-none" />
                                                                        </Column>
                                                                        <Column className="pl-3">
                                                                              <Text className="text-rc-label m-0 mb-1 uppercase text-xs leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                                                                                    Completion Date
                                                                              </Text>
                                                                              <Text className="m-0" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 16, lineHeight: 1.2, color: "#FFFFFF" }}>
                                                                                    {date}
                                                                              </Text>
                                                                        </Column>
                                                                  </Row>
                                                            </Column>
                                                      </Row>

                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Progress Indicator ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text className="mobile_font-24 text-rc-white m-0 mb-7 uppercase" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 28, lineHeight: 0.9, letterSpacing: "0.3px" }}>
                                                            Project Progress
                                                      </Text>

                                                      {/* Progress Bar */}
                                                      <Section className="mb-8" style={{ backgroundColor: "#1A2A42", borderRadius: 100, height: 6, fontSize: 0, lineHeight: 0 }}>
                                                            <Row>
                                                                  <Column style={{ backgroundColor: "#C9A84C", borderRadius: 100, height: 6, width: filledWidth, fontSize: 0, lineHeight: 0 }} />
                                                                  <Column style={{ width: emptyWidth, fontSize: 0, lineHeight: 0 }} />
                                                            </Row>
                                                      </Section>

                                                      {/* Progress Steps */}
                                                      <Row>
                                                            {steps.map((step, i) => (
                                                                  <ProgressStep
                                                                        key={step.label}
                                                                        label={step.label}
                                                                        state={step.state}
                                                                        mobileClass={[
                                                                              i > 0 ? "pl-1" : "pr-1",
                                                                              i > 0 && i < steps.length - 1 ? "px-1" : "",
                                                                        ].join(" ")}
                                                                  />
                                                            ))}
                                                      </Row>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Photo Updates Card ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded-md" style={{ border: "1px solid #1A2A42" }}>
                                                      <Section className="p-6">
                                                            <Row>
                                                                  <Column className="pr-4" verticalAlign="top" style={{ width: 36 }}>
                                                                        <Img alt="" height={28} src={ICONS.camera} width={28} className="block outline-none border-none" />
                                                                  </Column>
                                                                  <Column verticalAlign="top">
                                                                        <Text className="m-0 mb-1.5" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1.2, color: "#FFFFFF" }}>
                                                                              Photo Updates Available
                                                                        </Text>
                                                                        <Text className="m-0 mb-4" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 13, lineHeight: 1.5, letterSpacing: "0.2px", color: "#8A9BB5" }}>
                                                                              See the latest progress photos from your site on the client portal.
                                                                        </Text>
                                                                        <Link
                                                                              href={portalUrl}
                                                                              target="_blank"
                                                                              className="text-rc-gold no-underline"
                                                                              style={{ fontFamily: FONTS.body, fontWeight: 450, fontSize: 14, lineHeight: 1.5, letterSpacing: "-0.075px" }}
                                                                        >
                                                                              View Photos&nbsp;→
                                                                        </Link>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Next Milestone Notice ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded border-l-[3px] border-l-rc-gold">
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text className="text-rc-label m-0 mb-1.5 uppercase text-[11px] leading-relaxed tracking-[0.6px]" style={{ fontFamily: FONTS.body, fontWeight: 500 }}>
                                                                              Coming up next
                                                                        </Text>
                                                                        <Text className="text-rc-text m-0 text-sm leading-relaxed tracking-[0.2px]" style={{ fontFamily: FONTS.body, fontWeight: 400 }}>
                                                                              The next milestone is{" "}
                                                                              <span className="text-rc-white" style={{ fontWeight: 450 }}>{nextMilestone}</span>. We'll keep you updated as your project progresses.
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Questions ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text className="text-rc-white m-0 mb-1 text-[15px] leading-relaxed tracking-[-0.075px]" style={{ fontFamily: FONTS.body, fontWeight: 450 }}>
                                                            Questions about your build?
                                                      </Text>
                                                      <Text className="mobile_max-w-full text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]" style={{ fontFamily: FONTS.body, fontWeight: 300, maxWidth: 490 }}>
                                                            If you have any questions, do not hesitate to reach out at{" "}
                                                            <Link href="mailto:info@royalconstructions.com.au" className="text-rc-gold no-underline">info@royalconstructions.com.au</Link>{" "}
                                                            or call{" "}
                                                            <Link href="tel:1300832355" className="text-rc-gold no-underline">1300 832 355</Link>.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Sign-off ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="border-t border-rc-border pt-8">
                                                      <Text className="text-rc-white m-0 mb-1 text-sm leading-relaxed" style={{ fontFamily: FONTS.body, fontWeight: 400 }}>
                                                            Kind regards,
                                                      </Text>
                                                      <Text className="text-rc-gold m-0 mb-0.5 text-base leading-relaxed" style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}>
                                                            Gurpinder Uppal
                                                      </Text>
                                                      <Text className="text-rc-text m-0 text-[13px] leading-relaxed" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                                                            Royal Constructions Pty Ltd
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Footer ── */}
                                    <Footer />

                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}
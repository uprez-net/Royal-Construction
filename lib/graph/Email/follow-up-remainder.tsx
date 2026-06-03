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
  Button,
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
  facebookPage: "https://www.facebook.com/royalconstructionsau/",
  instagramPage: "https://www.instagram.com/royalconstructionsau/",
};

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
  calendar: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E`,
  clock: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
  pin: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'%3E%3C/path%3E%3Ccircle cx='12' cy='10' r='3'%3E%3C/circle%3E%3C/svg%3E`,
  user: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'%3E%3C/path%3E%3Ccircle cx='12' cy='7' r='4'%3E%3C/circle%3E%3C/svg%3E`,
  mail: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z'%3E%3C/path%3E%3Cpolyline points='22,6 12,13 2,6'%3E%3C/polyline%3E%3C/svg%3E`,
  phone: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'%3E%3C/path%3E%3C/svg%3E`,
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
}`;

const FONT_FACES_CSS = `
@font-face { font-family: 'IBM Plex Sans Condensed'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
`;

// ─── Sub-Components ─────────────────────────────────────────────────────────

function DetailRow({
  icon,
  label,
  value,
  showBorder = true,
}: {
  icon: string;
  label: string;
  value: string;
  showBorder?: boolean;
}) {
  return (
    <Row style={{ borderBottom: showBorder ? "1px solid #1B2D45" : undefined }}>
      <Column className="py-4 px-6">
        <Row>
          <Column className="pt-[2px]" style={{ width: 36 }} verticalAlign="top">
            <Img alt="" height={20} src={icon} width={20} className="block outline-none border-none" />
          </Column>
          <Column className="pl-3">
            <Text
              className="text-rc-label m-0 mb-1 uppercase text-[11px] leading-relaxed tracking-[0.4px]"
              style={{ fontFamily: FONTS.body, fontWeight: 300 }}
            >
              {label}
            </Text>
            <Text
              className="m-0"
              style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 16, lineHeight: 1.2, color: "#FFFFFF" }}
            >
              {value}
            </Text>
          </Column>
        </Row>
      </Column>
    </Row>
  );
}

function Footer() {
  return (
    <Section className="border-t border-rc-border bg-rc-footer">
      <Row>
        <Column className="mobile_px-4 mobile_py-12" style={{ padding: "3rem 1.5rem" }}>
          <Row>
            {/* ── Left Column ── */}
            <Column
              className="mobile_footer_left"
              width="55%"
              style={{ verticalAlign: "top", paddingRight: "2rem" }}
            >
              <Section className="bg-rc-light rounded-md mb-5">
                <Row>
                  <Column className="py-3 px-4">
                    <Link href={URLS.website} target="_blank" className="no-underline">
                      <Img alt="Royal Constructions" src={URLS.logo} width={110} className="block outline-none border-none no-underline h-auto" />
                    </Link>
                  </Column>
                </Row>
              </Section>

              <Text
                className="text-rc-muted m-0 mb-6 text-[13px] leading-relaxed tracking-[0.2px]"
                style={{ fontFamily: FONTS.body, fontWeight: 300, maxWidth: 280 }}
              >
                Royal Constructions — Building exceptional homes across NSW with quality craftsmanship and attention to detail.
              </Text>

              {/* Social Icons */}
              <table align="left" width="100%" border={0} cellPadding="0" cellSpacing="0" role="presentation" style={{ marginBottom: '1.5rem' }}>
                <tbody>
                  <tr>
                    <td>
                      <table align="left" width="50%" border={0} cellPadding="0" cellSpacing="0" role="presentation">
                        <tbody style={{ width: '100%' }}>
                          <tr style={{ width: '100%' }}>
                            <td style={{ paddingRight: '1rem' }}>
                              <Link href={URLS.facebookPage} target="_blank" style={{ color: '#067df7', textDecorationLine: 'none', display: 'inline-block' }}>
                                <Img alt="Facebook" height={24} src={URLS.facebook} width={24} style={{ display: 'block', outline: 'none', border: 'none' }} />
                              </Link>
                            </td>
                            <td>
                              <Link href={URLS.instagramPage} target="_blank" style={{ color: '#067df7', textDecorationLine: 'none', display: 'inline-block' }}>
                                <Img alt="Instagram" height={24} src={URLS.instagram} width={24} style={{ display: 'block', outline: 'none', border: 'none' }} />
                              </Link>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>

              <Text className="text-rc-muted m-0 mb-4 text-[11px] leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                <span className="text-rc-white" style={{ fontWeight: 450 }}>Office</span><br />
                38/62 Turner RD<br />
                Smeaton Grange, NSW 2567
              </Text>

              <Text className="text-rc-muted m-0 mb-5 text-[11px] leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                <span className="text-rc-white" style={{ fontWeight: 450 }}>Contact</span><br />
                <Link href="tel:1300832355" className="text-rc-muted no-underline">1300 832 355</Link><br />
                <Link href="mailto:info@royalconstructions.com.au" className="text-rc-muted no-underline">info@royalconstructions.com.au</Link>
              </Text>

              <Text className="text-rc-dimmed m-0 text-[11px] leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                <Link href="#" className="text-rc-dimmed no-underline">Unsubscribe</Link> from Royal Constructions marketing emails.
              </Text>
            </Column>

            {/* ── Right Column — Accredited By ── */}
            <Column className="mobile_footer_right" width="45%" style={{ verticalAlign: "top", paddingLeft: "0.5rem" }}>
              <Section className="bg-rc-light rounded-md">
                <Row>
                  <Column className="p-5">
                    <Text className="text-[#1B2D45] m-0 mb-4 text-[10px] leading-relaxed tracking-[0.8px] uppercase" style={{ fontFamily: FONTS.body, fontWeight: 500 }}>
                      Accredited by
                    </Text>
                    <Link href={URLS.website} target="_blank" className="no-underline">
                      <Img alt="Master Builders Association" src={URLS.mbaLogo} width={100} className="block outline-none border-none no-underline h-auto mb-4" />
                    </Link>
                    <Link href={URLS.website} target="_blank" className="no-underline">
                      <Img alt="Oran Park" src={URLS.oranPark} width={120} className="block outline-none border-none no-underline h-auto" />
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

interface FollowUpReminderEmailProps {
  assigneeName?: string;
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  leadLocation?: string;
  followupTime?: string;
  followupNotes?: string;
  crmUrl?: string;
}

export default function FollowUpReminderEmail({
  assigneeName = "Team",
  leadName = "Unknown Lead",
  leadPhone = "Not provided",
  leadEmail = "Not provided",
  leadLocation = "Not provided",
  followupTime = "Anytime today",
  followupNotes = "",
  crmUrl = "https://royalconstructions.com.au/",
}: FollowUpReminderEmailProps) {
  return (
    <Tailwind
      config={{
        theme: {
          extend: {
            colors: {
              rc: {
                dark: "#0B1623",
                container: "#0E1C2F",
                card: "#122440",
                border: "#1B2D45",
                footer: "#091320",
                gold: "#C6923A",
                white: "#FFFFFF",
                text: "#B0BFCF",
                muted: "#7E93AB",
                dimmed: "#3A4E68",
                light: "#F7F6F2",
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
            You have a scheduled lead follow-up task that requires your attention today.
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

            {/* ── Hero ── */}
            <Section className="mobile_px-4 mobile_pt-10" style={{ padding: "3.5rem 1.5rem 2rem" }}>
              <Row>
                <Column>
                  <Text
                    className="text-rc-gold m-0 mb-4 text-[11px] leading-none tracking-[1.2px] uppercase"
                    style={{ fontFamily: FONTS.body, fontWeight: 500 }}
                  >
                    Daily Lead Reminder
                  </Text>
                  <Text
                    className="mobile_font-40 text-rc-white m-0 uppercase"
                    style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 48, lineHeight: 1, letterSpacing: "-1.4px" }}
                  >
                    Follow-up
                    <br />
                    Required
                  </Text>
                </Column>
              </Row>
            </Section>

            {/* ── Intro ── */}
            <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
              <Row>
                <Column>
                  <Text className="text-rc-text m-0 mb-5" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px" }}>
                    Hi {assigneeName} 👋,
                  </Text>
                  <Text
                    className="mobile_max-w-full text-rc-text m-0"
                    style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px", maxWidth: 480 }}
                  >
                    You have a scheduled follow-up task that requires your attention today. Taking quick action helps keep our leads warm and engaged. Please review the details below:
                  </Text>
                </Column>
              </Row>
            </Section>

            {/* ── Lead Details Card ── */}
            <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
              <Row>
                <Column className="bg-rc-card rounded-md overflow-hidden" style={{ border: "1px solid #1B2D45" }}>

                  {/* Card Header & Badge */}
                  <Row className="bg-rc-gold">
                    <Column className="py-3.5 px-6" style={{ width: '70%', verticalAlign: 'middle' }}>
                      <Text className="text-rc-container m-0 uppercase text-[13px] leading-none tracking-[0.6px]" style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}>
                        Lead Details
                      </Text>
                    </Column>
                    <Column className="py-3.5 px-6 text-right" style={{ width: '30%', verticalAlign: 'middle' }}>
                      <Section className="bg-rc-container rounded-full inline-block">
                        <Row>
                          <Column className="py-1 px-3">
                            <Text className="text-rc-gold m-0 uppercase text-[10px] tracking-[0.5px]" style={{ fontFamily: FONTS.body, fontWeight: 700 }}>
                              Action Required
                            </Text>
                          </Column>
                        </Row>
                      </Section>
                    </Column>
                  </Row>

                  {/* Card Rows */}
                  <DetailRow icon={ICONS.user} label="Client" value={leadName} showBorder />
                  <DetailRow icon={ICONS.phone} label="Phone" value={leadPhone} showBorder />
                  <DetailRow icon={ICONS.mail} label="Email" value={leadEmail} showBorder />
                  <DetailRow icon={ICONS.pin} label="Location" value={leadLocation} showBorder />
                  <DetailRow icon={ICONS.clock} label="Follow-up Time" value={followupTime} showBorder={false} />

                </Column>
              </Row>
            </Section>

            {/* ── Context & Notes Block ── */}
            {followupNotes && (
              <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                <Row>
                  <Column className="bg-rc-container rounded border-l-[4px] border-l-rc-gold">
                    <Section className="py-4 px-5">
                      <Row>
                        <Column>
                          <Text className="text-rc-muted m-0 mb-2 uppercase text-[10px] tracking-[0.5px]" style={{ fontFamily: FONTS.body, fontWeight: 700 }}>
                            💬 Context & Notes
                          </Text>
                          <Text className="text-rc-text m-0 text-[13px] leading-relaxed" style={{ fontFamily: FONTS.body, fontWeight: 350, fontStyle: 'italic' }}>
                            "{followupNotes}"
                          </Text>
                        </Column>
                      </Row>
                    </Section>
                  </Column>
                </Row>
              </Section>
            )}

            {/* ── CTA Button ── */}
            <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
              <Row>
                <Column className="text-center">
                  <Button
                    href={crmUrl}
                    target="_blank"
                    className="bg-rc-gold text-rc-container no-underline uppercase tracking-[1px]"
                    style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1, padding: "1rem 3rem", borderRadius: 50 }}
                  >
                    Open Lead in CRM →
                  </Button>
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
                    Royal Constructions CRM
                  </Text>
                  <Text className="text-rc-text m-0 text-[13px] leading-relaxed" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                    Automated Notification System
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
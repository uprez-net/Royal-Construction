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
  claimOffer: "https://royalconstructions.com.au/claim-offer/",
  terms: "https://royalconstructions.com.au/terms/",
  facebookPage: "https://www.facebook.com/royalconstructionsau/",
  instagramPage: "https://www.instagram.com/royalconstructionsau/",
};

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
  star: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'%3E%3C/polygon%3E%3C/svg%3E`,
  tree: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M17 8c.7-1 1-2.2 1-3.5C18 2.5 16.5 1 14.5 1c-1 0-1.8.4-2.5 1C11.3 1.4 10.5 1 9.5 1 7.5 1 6 2.5 6 4.5 6 5.8 6.3 7 7 8'%3E%3C/path%3E%3Cpath d='M12 2v20'%3E%3C/path%3E%3Cpath d='M7 8h10l-5 8-5-8z'%3E%3C/path%3E%3C/svg%3E`,
  clock: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
  clockDark: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%230C1829' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
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
  .mobile_font-40 { font-size: 28px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
  .mobile_font-56 { font-size: 40px !important; line-height: 1 !important; }
  .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
  .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
  .mobile_offer_stack { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; padding-bottom: 1rem !important; }
  .mobile_offer_last { padding-bottom: 0 !important; }
}`;

const FONT_FACES_CSS = `
@font-face { font-family: 'IBM Plex Sans Condensed'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/ibmplexsanscondensed/v15/Gg8gN4UfRSqiPg7Jn2ZI12V4DCEwkj1E4LVeHY5a64vr.ttf) format('truetype'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2) format('woff2'); }
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; mso-font-alt: 'Arial'; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
`;

// ─── Sub-Components ─────────────────────────────────────────────────────────

function OfferCard({
  icon,
  title,
  badge,
  badgeVariant = "outline",
  mobileClass = "",
}: {
  icon: string;
  title: string;
  badge: string;
  badgeVariant?: "solid" | "outline";
  mobileClass?: string;
}) {
  return (
    <Column
      className={`mobile_offer_stack ${mobileClass}`}
      style={{ width: "33.33%", verticalAlign: "top" }}
    >
      <Section
        className="bg-rc-card rounded-md"
        style={{ border: "1px solid #1A2A42", height: "100%" }}
      >
        <Row>
          <Column className="py-6 px-4 text-center">
            <Img
              alt=""
              height={32}
              src={icon}
              width={32}
              className="block outline-none border-none mx-auto mb-3.5"
            />
            <Text
              className="m-0 mb-2 text-[13px] leading-tight"
              style={{ fontFamily: FONTS.condensed, fontWeight: 500, color: "#FFFFFF" }}
            >
              {title}
            </Text>

            {badgeVariant === "solid" ? (
              <Section className="mx-auto" style={{ display: "inline-block" }}>
                <Row>
                  <Column className="bg-rc-gold rounded-sm">
                    <Text
                      className="m-0 uppercase tracking-[0.5px]"
                      style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 11, lineHeight: 1, color: "#0C1829", padding: "0.25rem 0.5rem" }}
                    >
                      {badge}
                    </Text>
                  </Column>
                </Row>
              </Section>
            ) : (
              <Section className="mx-auto" style={{ display: "inline-block" }}>
                <Row>
                  <Column className="rounded-sm" style={{ backgroundColor: "#1A2A42", border: "1px solid #2A3E5C" }}>
                    <Text
                      className="m-0 uppercase tracking-[0.5px] text-rc-gold"
                      style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 11, lineHeight: 1, padding: "0.25rem 0.5rem" }}
                    >
                      {badge}
                    </Text>
                  </Column>
                </Row>
              </Section>
            )}
          </Column>
        </Row>
      </Section>
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

interface SpecialOfferEmailProps {
  name?: string;
  savingsAmount?: string;
  claimUrl?: string;
}

export default function SpecialOfferEmail({
  name = "Homeowner",
  savingsAmount = "$8,500",
  claimUrl = URLS.claimOffer,
}: SpecialOfferEmailProps) {
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
            Exclusive upgrade package — confirm within 7 days to claim your offer
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

            {/* ── Gold Accent Bar ── */}
            <Section>
              <Row>
                <Column className="bg-rc-gold h-[3px]" style={{ fontSize: 1, lineHeight: "1px" }}>
                  &nbsp;
                </Column>
              </Row>
            </Section>

            {/* ── Hero ── */}
            <Section className="mobile_px-4" style={{ padding: "3rem 1.5rem 0" }}>
              <Row>
                <Column className="text-center">
                  <Text
                    className="text-rc-gold m-0 mb-5 text-[11px] leading-none tracking-[1.5px] uppercase"
                    style={{ fontFamily: FONTS.body, fontWeight: 500 }}
                  >
                    Exclusive Offer
                  </Text>
                  <Text
                    className="mobile_font-40 text-rc-white m-0 mb-6 uppercase"
                    style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 48, lineHeight: 1, letterSpacing: "-1.4px" }}
                  >
                    Your Dream Home,
                    <br />
                    Elevated
                  </Text>
                  <Text
                    className="mobile_max-w-full text-rc-text m-0 mx-auto"
                    style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px", maxWidth: 440 }}
                  >
                    Dear {name}, as a valued Royal Constructions client, we're thrilled to offer you an exclusive upgrade package — on us.
                  </Text>
                </Column>
              </Row>
            </Section>

            {/* ── Big Savings Callout ── */}
            <Section className="mobile_px-4" style={{ padding: "2.5rem 1.5rem 3rem" }}>
              <Row>
                <Column className="text-center">
                  <Section className="bg-rc-card rounded-lg mx-auto" style={{ border: "1px solid #1A2A42", display: "inline-block" }}>
                    <Row>
                      <Column className="py-8 px-12 text-center">
                        <Text
                          className="text-rc-label m-0 mb-3 text-[11px] leading-none tracking-[1px] uppercase"
                          style={{ fontFamily: FONTS.body, fontWeight: 500 }}
                        >
                          You could save up to
                        </Text>
                        <Text
                          className="mobile_font-56 m-0"
                          style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 56, lineHeight: 1, color: "#C9A84C", letterSpacing: "-1px" }}
                        >
                          {savingsAmount}
                        </Text>
                      </Column>
                    </Row>
                  </Section>
                </Column>
              </Row>
            </Section>

            {/* ── 3 Offer Cards ── */}
            <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
              <Row>
                <OfferCard
                  icon={ICONS.star}
                  title={<>FREE Premium<br />Kitchen Upgrade</>}
                  badge={`Value ${savingsAmount}`}
                  badgeVariant="solid"
                  mobileClass="mobile_offer_stack pr-2"
                />
                <OfferCard
                  icon={ICONS.tree}
                  title={<>Complimentary<br />Landscaping Consult</>}
                  badge="Free"
                  badgeVariant="outline"
                  mobileClass="mobile_offer_stack px-1"
                />
                <OfferCard
                  icon={ICONS.clock}
                  title={<>Priority<br />Scheduling</>}
                  badge="Fast-Track"
                  badgeVariant="outline"
                  mobileClass="mobile_offer_stack mobile_offer_last pl-2"
                />
              </Row>
            </Section>

            {/* ── Urgency Bar ── */}
            <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
              <Row>
                <Column className="bg-rc-gold rounded-lg overflow-hidden">
                  <Section className="py-5 px-6">
                    <Row>
                      <Column className="text-center">
                        <Section className="mx-auto" style={{ display: "inline-block" }}>
                          <Row>
                            <Column className="pr-3" verticalAlign="middle">
                              <Img alt="" height={20} src={ICONS.clockDark} width={20} className="block outline-none border-none" />
                            </Column>
                            <Column verticalAlign="middle">
                              <Text
                                className="m-0 uppercase tracking-[0.8px]"
                                style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 14, lineHeight: 1, color: "#0C1829" }}
                              >
                                Confirm within 7 days to unlock this offer
                              </Text>
                            </Column>
                          </Row>
                        </Section>
                      </Column>
                    </Row>
                  </Section>
                </Column>
              </Row>
            </Section>

            {/* ── CTA ── */}
            <Section className="mobile_px-4" style={{ padding: "0.5rem 1.5rem 2.5rem" }}>
              <Row>
                <Column className="text-center">
                  <Text className="text-rc-text m-0 mb-7" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px" }}>
                    Let's discuss how we can make your dream home even better.
                  </Text>
                  <Button
                    href={claimUrl}
                    target="_blank"
                    className="bg-rc-gold text-rc-container no-underline uppercase tracking-[1px]"
                    style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1, padding: "1rem 3rem", borderRadius: 4 }}
                  >
                    Claim Your Offer
                  </Button>
                </Column>
              </Row>
            </Section>

            {/* ── Terms ── */}
            <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
              <Row>
                <Column className="text-center">
                  <Text className="text-rc-dimmed m-0 text-[11px] leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                    Offer valid for new confirmations only. Kitchen upgrade applies to selected ranges.{" "}
                    <Link href={URLS.terms} target="_blank" className="text-rc-dimmed underline">
                      Full terms &amp; conditions
                    </Link>.
                  </Text>
                </Column>
              </Row>
            </Section>

            {/* ── Sign-off ── */}
            <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
              <Row>
                <Column className="border-t border-rc-border pt-8">
                  <Text className="text-rc-white m-0 mb-1 text-sm leading-relaxed" style={{ fontFamily: FONTS.body, fontWeight: 400 }}>
                    Warm regards,
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
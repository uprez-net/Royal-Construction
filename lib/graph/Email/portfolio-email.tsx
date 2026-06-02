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
      heroImage:
            "https://royalconstructions.com.au/wp-content/smush-webp/2026/04/CUSTOM-DESIGN_CUSTOM_DUAL-OCCUPANCY_FINAL_V2-1024x683.jpg.webp",
      facebook: "https://royal-construction-chi.vercel.app/facebook.svg",
      instagram: "https://royal-construction-chi.vercel.app/instagram.svg",
      mbaLogo: "https://royal-construction-chi.vercel.app/image-78.png",
      oranPark:
            "https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp",
      website: "https://royalconstructions.com.au/",
      contact: "https://royalconstructions.com.au/contact/",
      facebookPage: "https://www.facebook.com/royalconstructionsau/",
      instagramPage: "https://www.instagram.com/royalconstructionsau/",
      builderProfile:
            "https://royal-construction-chi.vercel.app/Royal_Constructions_Builder_Profile_1.pdf",
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
  .mobile_font-40 { font-size: 34px !important; line-height: 1.1 !important; letter-spacing: -0.8px !important; }
  .mobile_footer_left { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 2rem !important; }
  .mobile_footer_right { display: block !important; width: 100% !important; padding-left: 0 !important; }
}`;

const FONT_FACES_CSS = `
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

// ─── Credential Item Sub-Component ──────────────────────────────────────────

function CredentialItem({ text }: { text: string }) {
      return (
            <Row style={{ marginBottom: "0.625rem" }}>
                  <Column style={{ width: 24, verticalAlign: "top", paddingTop: "2px" }}>
                        <Text
                              className="text-rc-gold m-0 text-[16px] leading-none"
                              style={{ fontFamily: FONTS.body }}
                        >
                              ✓
                        </Text>
                  </Column>
                  <Column className="pl-2">
                        <Text
                              className="text-sm leading-relaxed tracking-[0.3px] text-rc-text m-0"
                              style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                        >
                              {text}
                        </Text>
                  </Column>
            </Row>
      );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface PortfolioEmailProps {
      name?: string;
}

export default function PortfolioEmail({ name = "Homeowner" }: PortfolioEmailProps) {
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
                                                "gold-light": "#D4A034",
                                                white: "#FFFFFF",
                                                text: "#B0BFCF",
                                                muted: "#7E93AB",
                                                dimmed: "#3A4E68",
                                                light: "#F7F6F2",
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
                              {/* ── Preheader ── */}
                              <div className="hidden overflow-hidden leading-none opacity-none max-h-0 max-w-0">
                                    Royal Constructions — Our Builder Profile, Licences, and Project
                                    Portfolio attached for your review.
                                    <div>
                                          &nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏
                                    </div>
                              </div>

                              {/* ── Main Container ── */}
                              <Container className="max-w-[640px] bg-rc-container mx-auto">
                                    {/* ══════════════════════════════════════════════════════════════════
                         HEADER (identical to welcome email)
                    ══════════════════════════════════════════════════════════════════ */}
                                    <Section className="bg-rc-light">
                                          <Row>
                                                <Column className="py-5 px-6">
                                                      <Link
                                                            href={URLS.website}
                                                            target="_blank"
                                                            className="no-underline"
                                                      >
                                                            <Img
                                                                  alt="Royal Constructions"
                                                                  src={URLS.logo}
                                                                  width={140}
                                                                  className="block outline-none border-none no-underline h-auto"
                                                            />
                                                      </Link>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ══════════════════════════════════════════════════════════════════
                         HERO SECTION
                    ══════════════════════════════════════════════════════════════════ */}
                                    <Section
                                          className="mobile_px-4 mobile_pt-10 mobile_pb-8"
                                          style={{ padding: "4rem 1.5rem 3rem" }}
                                    >
                                          <Row>
                                                <Column className="mobile_max-w-full" style={{ maxWidth: 490 }}>
                                                      <Text
                                                            className="mobile_font-40 text-rc-white m-0 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 52,
                                                                  lineHeight: 1,
                                                                  letterSpacing: "-1.5px",
                                                            }}
                                                      >
                                                            Builder Profile
                                                            <br />
                                                            &amp; Portfolio
                                                      </Text>

                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0 mt-10"
                                                            style={{
                                                                  fontFamily: FONTS.body,
                                                                  fontWeight: 350,
                                                                  fontSize: 14,
                                                                  lineHeight: 1.7,
                                                                  letterSpacing: "0.3px",
                                                                  maxWidth: 490,
                                                            }}
                                                      >
                                                            Hi {name}, thank you for your interest in building with
                                                            Royal Constructions.
                                                      </Text>

                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0 mt-4"
                                                            style={{
                                                                  fontFamily: FONTS.body,
                                                                  fontWeight: 350,
                                                                  fontSize: 14,
                                                                  lineHeight: 1.7,
                                                                  letterSpacing: "0.3px",
                                                                  maxWidth: 490,
                                                            }}
                                                      >
                                                            To give you complete peace of mind, I have attached our
                                                            official{" "}
                                                            <span className="text-rc-white" style={{ fontWeight: 500 }}>
                                                                  Builder Profile
                                                            </span>
                                                            . Inside, you will find our comprehensive company
                                                            overview, including:
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Hero Image ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Img
                                                            alt="Royal Constructions Portfolio"
                                                            src={URLS.heroImage}
                                                            width={592}
                                                            className="block outline-none border-none no-underline w-full max-w-[592px] rounded"
                                                      />
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ══════════════════════════════════════════════════════════════════
                         CREDENTIALS CARD
                    ══════════════════════════════════════════════════════════════════ */}
                                    <Section
                                          className="mobile_px-4 mobile_pt-10"
                                          style={{ padding: "3rem 1.5rem 0" }}
                                    >
                                          <Row>
                                                <Column
                                                      className="bg-rc-card rounded border border-rc-gold"
                                                      style={{ padding: "1.5rem" }}
                                                >
                                                      <Text
                                                            className="text-rc-gold m-0 mb-3 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 18,
                                                                  lineHeight: 1,
                                                                  letterSpacing: "0.6px",
                                                            }}
                                                      >
                                                            What&apos;s inside
                                                      </Text>
                                                      <Text
                                                            className="mobile_font-24 text-rc-white m-0 mb-5 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 28,
                                                                  lineHeight: 1,
                                                                  letterSpacing: "0.4px",
                                                            }}
                                                      >
                                                            Our Builder Profile Includes
                                                      </Text>

                                                      <CredentialItem text="Our NSW Builder's Licence & Insurances" />
                                                      <CredentialItem text="Master Builders Association Accreditations" />
                                                      <CredentialItem text="A detailed list of our active and recently completed projects across Greater Sydney" />

                                                      <Text
                                                            className="text-sm leading-relaxed tracking-[0.3px] text-rc-text m-0 mt-5 mb-6"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                                                      >
                                                            We manage every project from approval through to handover
                                                            with no outsourcing of responsibility, ensuring consistency
                                                            and quality on every job.
                                                      </Text>

                                                      {/* ── Primary CTA ── */}
                                                      <Link
                                                            href={URLS.builderProfile}
                                                            target="_blank"
                                                            className="bg-rc-gold text-rc-dark no-underline inline-block rounded"
                                                            style={{
                                                                  fontFamily: FONTS.body,
                                                                  fontWeight: 700,
                                                                  fontSize: 15,
                                                                  lineHeight: 1.4,
                                                                  padding: "0.875rem 1.25rem",
                                                            }}
                                                      >
                                                            Download / View Builder Profile
                                                      </Link>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Reply Prompt ── */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "2rem 1.5rem 0" }}
                                    >
                                          <Row>
                                                <Column
                                                      className="bg-rc-card rounded border-l-[3px] border-l-rc-gold"
                                                >
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text
                                                                              className="text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]"
                                                                              style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                                                                        >
                                                                              Please feel free to review the attached document.
                                                                              If you have any questions or are ready to discuss
                                                                              your specific project requirements, simply reply to
                                                                              this email or call us on{" "}
                                                                              <Link
                                                                                    href="tel:1300832355"
                                                                                    className="text-rc-gold no-underline"
                                                                              >
                                                                                    1300 832 355
                                                                              </Link>
                                                                              .
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ══════════════════════════════════════════════════════════════════
                         SIGN-OFF (identical to welcome email)
                    ══════════════════════════════════════════════════════════════════ */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "3rem 1.5rem 3rem" }}
                                    >
                                          <Row>
                                                <Column
                                                      className="border-t border-rc-border pt-8"
                                                >
                                                      <Text
                                                            className="text-rc-text m-0 mb-6 text-sm leading-relaxed tracking-[0.3px]"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                                                      >
                                                            We look forward to building something extraordinary with you.
                                                      </Text>
                                                      <Text
                                                            className="text-rc-white m-0 mb-1 text-sm leading-relaxed"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 400 }}
                                                      >
                                                            Warm regards,
                                                      </Text>
                                                      <Text
                                                            className="text-rc-gold m-0 text-base leading-relaxed"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}
                                                      >
                                                            Gurpinder Uppal
                                                      </Text>
                                                      <Text
                                                            className="text-rc-text m-0 text-[13px] leading-relaxed"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 300 }}
                                                      >
                                                            Royal Constructions Pty Ltd
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ══════════════════════════════════════════════════════════════════
                         FOOTER (identical to welcome email)
                    ══════════════════════════════════════════════════════════════════ */}
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
                                                                                          className="text-[#1B2D45] m-0 mb-4 text-[10px] leading-relaxed tracking-[0.8px] uppercase"
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
                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}

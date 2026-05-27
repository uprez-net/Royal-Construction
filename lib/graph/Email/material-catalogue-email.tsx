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
      heroImage: "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=592&h=280&fit=crop&auto=format",
      facebook: "https://royal-construction-chi.vercel.app/facebook.svg",
      instagram: "https://royal-construction-chi.vercel.app/instagram.svg",
      mbaLogo: "https://royal-construction-chi.vercel.app/image-78.png",
      oranPark:
            "https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp",
      website: "https://royalconstructions.com.au/",
      catalogue: "https://royalconstructions.com.au/catalogue/",
      facebookPage: "https://www.facebook.com/royalconstructionsau/",
      instagramPage: "https://www.instagram.com/royalconstructionsau/",
};

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
      bricks: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='1' y='3' width='15' height='13'%3E%3C/rect%3E%3Cpolygon points='16 8 20 8 23 11 23 16 16 16 16 8'%3E%3C/polygon%3E%3Ccircle cx='5.5' cy='18.5' r='2.5'%3E%3C/circle%3E%3Ccircle cx='18.5' cy='18.5' r='2.5'%3E%3C/circle%3E%3C/svg%3E`,
      slab: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='3' y1='9' x2='21' y2='9'%3E%3C/line%3E%3Cline x1='9' y1='21' x2='9' y2='9'%3E%3C/line%3E%3C/svg%3E`,
      roofing: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'%3E%3C/path%3E%3Cpolyline points='9 22 9 12 15 12 15 22'%3E%3C/polyline%3E%3C/svg%3E`,
      fixtures: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='5'%3E%3C/circle%3E%3Cline x1='12' y1='1' x2='12' y2='3'%3E%3C/line%3E%3Cline x1='12' y1='21' x2='12' y2='23'%3E%3C/line%3E%3Cline x1='4.22' y1='4.22' x2='5.64' y2='5.64'%3E%3C/line%3E%3Cline x1='18.36' y1='18.36' x2='19.78' y2='19.78'%3E%3C/line%3E%3Cline x1='1' y1='12' x2='3' y2='12'%3E%3C/line%3E%3Cline x1='21' y1='12' x2='23' y2='12'%3E%3C/line%3E%3Cline x1='4.22' y1='19.78' x2='5.64' y2='18.36'%3E%3C/line%3E%3Cline x1='18.36' y1='5.64' x2='19.78' y2='4.22'%3E%3C/line%3E%3C/svg%3E`,
      kitchen: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 8h1a4 4 0 0 1 0 8h-1'%3E%3C/path%3E%3Cpath d='M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z'%3E%3C/path%3E%3Cline x1='6' y1='1' x2='6' y2='4'%3E%3C/line%3E%3Cline x1='10' y1='1' x2='10' y2='4'%3E%3C/line%3E%3Cline x1='14' y1='1' x2='14' y2='4'%3E%3C/line%3E%3C/svg%3E`,
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

function CategoryItem({
      icon,
      title,
      description,
      showBorder = true,
}: {
      icon: string;
      title: string;
      description: string;
      showBorder?: boolean;
}) {
      return (
            <Row
                  style={{
                        borderBottom: showBorder ? "1px solid #1A2A42" : undefined,
                        paddingBottom: showBorder ? "1.75rem" : 0,
                        marginBottom: showBorder ? "1.75rem" : 0,
                  }}
            >
                  <Column
                        className="pt-[2px]"
                        style={{ width: 44 }}
                        verticalAlign="top"
                  >
                        <Img
                              alt=""
                              height={26}
                              src={icon}
                              width={26}
                              className="block outline-none border-none"
                        />
                  </Column>
                  <Column className="pl-3">
                        <Text
                              className="m-0 mb-1.5 text-base leading-tight"
                              style={{ fontFamily: FONTS.condensed, fontWeight: 500, color: "#FFFFFF" }}
                        >
                              {title}
                        </Text>
                        <Text
                              className="m-0 text-[13px] leading-relaxed tracking-[0.2px]"
                              style={{ fontFamily: FONTS.body, fontWeight: 350, color: "#8A9BB5" }}
                        >
                              {description}
                        </Text>
                  </Column>
            </Row>
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

interface MaterialCatalogueEmailProps {
      name?: string;
      catalogueUrl?: string;
}

export default function MaterialCatalogueEmail({
      name = "Homeowner",
      catalogueUrl = URLS.catalogue,
}: MaterialCatalogueEmailProps) {
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
                                    Explore our material catalogue and choose your preferred finishes
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
                                                            Material Catalogue
                                                      </Text>
                                                      <Text
                                                            className="mobile_font-40 text-rc-white m-0 uppercase"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 48, lineHeight: 1, letterSpacing: "-1.4px" }}
                                                      >
                                                            Curate Your
                                                            <br />
                                                            Space
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Hero Image ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Img
                                                            alt="Premium home finishes and materials"
                                                            src={URLS.heroImage}
                                                            width={592}
                                                            className="block outline-none border-none w-full max-w-[592px] rounded"
                                                      />
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Intro ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text className="text-rc-text m-0 mb-5" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px" }}>
                                                            Dear {name},
                                                      </Text>
                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px", maxWidth: 480 }}
                                                      >
                                                            As discussed, it's time to bring your vision to life. Explore our curated material catalogue below and select the premium finishes that will make your house truly feel like home.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Selection Categories ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="mobile_font-24 text-rc-white m-0 mb-8 uppercase"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 28, lineHeight: 0.9, letterSpacing: "0.3px" }}
                                                      >
                                                            Selection Categories
                                                      </Text>

                                                      <CategoryItem
                                                            icon={ICONS.bricks}
                                                            title="Bricks & External Cladding"
                                                            description="Define the exterior character and street appeal of your new home."
                                                            showBorder
                                                      />

                                                      <CategoryItem
                                                            icon={ICONS.slab}
                                                            title="Slab & Foundation Options"
                                                            description="The structural backbone — ensure lasting quality from the ground up."
                                                            showBorder
                                                      />

                                                      <CategoryItem
                                                            icon={ICONS.roofing}
                                                            title="Roofing Materials"
                                                            description="Protect and crown your home with premium, durable roofing."
                                                            showBorder
                                                      />

                                                      <CategoryItem
                                                            icon={ICONS.fixtures}
                                                            title="Internal Fixtures & Fittings"
                                                            description="The finishing touches that complete every room with style."
                                                            showBorder
                                                      />

                                                      <CategoryItem
                                                            icon={ICONS.kitchen}
                                                            title="Kitchen & Bathroom Selections"
                                                            description="Choose the heart and sanctuary of your home — benchtops, tapware, and more."
                                                            showBorder={false}
                                                      />

                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Browse Catalogue CTA ── */}
                                    <Section className="mobile_px-4" style={{ padding: "2rem 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column className="text-center">
                                                      <Button
                                                            href={catalogueUrl}
                                                            target="_blank"
                                                            className="bg-rc-gold text-rc-container no-underline uppercase tracking-[1px]"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1, padding: "1rem 2.5rem", borderRadius: 4 }}
                                                      >
                                                            Browse Catalogue
                                                      </Button>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Variation Notice ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded border-l-[3px] border-l-rc-gold">
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text className="text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]" style={{ fontFamily: FONTS.body, fontWeight: 400 }}>
                                                                              Selecting premium finishes may apply variations to your quotation. We'll notify you of any{" "}
                                                                              <span className="text-rc-gold" style={{ fontWeight: 450 }}>cost adjustments</span> before finalizing your selections.
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
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
                                                            Guri Singh
                                                      </Text>
                                                      <Text className="text-rc-text m-0 text-[13px] leading-relaxed" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                                                            Royal Constructions NSW
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
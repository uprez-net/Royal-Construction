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
      approve: "https://royalconstructions.com.au/approve-quote/",
      facebookPage: "https://www.facebook.com/royalconstructionsau/",
      instagramPage: "https://www.instagram.com/royalconstructionsau/",
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

function QuoteRow({
      label,
      value,
      isAmount = false,
      showBorder = true,
}: {
      label: string;
      value: string;
      isAmount?: boolean;
      showBorder?: boolean;
}) {
      return (
            <Row
                  style={{ borderBottom: showBorder ? "1px solid #1B2D45" : undefined }}
            >
                  <Column
                        className="py-4 px-6"
                        style={{ width: "40%", verticalAlign: "top" }}
                  >
                        <Text
                              className="text-[#6B7F9E] m-0 text-xs leading-relaxed tracking-[0.3px] uppercase"
                              style={{ fontFamily: FONTS.body, fontWeight: 300 }}
                        >
                              {label}
                        </Text>
                  </Column>
                  <Column className="py-4 pl-4 pr-6" style={{ verticalAlign: "top" }}>
                        <Text
                              className="m-0"
                              style={{
                                    fontFamily: isAmount ? FONTS.condensed : FONTS.body,
                                    fontSize: isAmount ? 22 : 14,
                                    lineHeight: isAmount ? 1.1 : 1.4,
                                    fontWeight: isAmount ? 500 : 450,
                                    letterSpacing: isAmount ? undefined : "0.2px",
                                    color: isAmount ? "#C6923A" : "#FFFFFF",
                              }}
                        >
                              {value}
                        </Text>
                  </Column>
            </Row>
      );
}

function ProceedStep({
      num,
      title,
      description,
      showBorder = true,
}: {
      num: string;
      title: string;
      description: React.ReactNode;
      showBorder?: boolean;
}) {
      return (
            <Row
                  style={{
                        borderBottom: showBorder ? "1px solid #1B2D45" : undefined,
                        paddingBottom: showBorder ? "1.75rem" : 0,
                        marginBottom: showBorder ? "1.75rem" : 0,
                  }}
            >
                  <Column
                        className="pt-[2px]"
                        style={{ width: 40 }}
                        verticalAlign="top"
                  >
                        <table
                              width="28"
                              height="28"
                              cellPadding="0"
                              cellSpacing="0"
                              role="presentation"
                              style={{ backgroundColor: "#C6923A", borderRadius: "50%" }}
                        >
                              <tr>
                                    <td
                                          style={{
                                                textAlign: "center",
                                                verticalAlign: "middle",
                                                height: 28,
                                          }}
                                    >
                                          <Text
                                                className="m-0 text-[13px] leading-none"
                                                style={{
                                                      fontFamily: FONTS.condensed,
                                                      fontWeight: 500,
                                                      color: "#0E1C2F",
                                                }}
                                          >
                                                {num}
                                          </Text>
                                    </td>
                              </tr>
                        </table>
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
                              style={{ fontFamily: FONTS.body, fontWeight: 350, color: "#B0BFCF" }}
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
      );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface QuotationEmailProps {
      name?: string;
      project?: string;
      location?: string;
      type?: string;
      amount?: string;
      duration?: string;
      approveUrl?: string;
}

export default function QuotationEmail({
      name = "Client",
      project = "Your Project",
      location = "Your Location",
      type = "Residential Build",
      amount = "$0",
      duration = "TBD",
      approveUrl = URLS.approve,
}: QuotationEmailProps) {
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

                        <Body
                              className="bg-rc-dark m-0 p-0 text-sm leading-relaxed tracking-[0.3px]"
                              style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                        >
                              {/* Preheader */}
                              <div className="hidden overflow-hidden leading-none opacity-none max-h-0 max-w-0">
                                    Your Personalized Quotation — Review your project details and approve
                                    to get started
                                    <div>
                                          &nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏
                                    </div>
                              </div>

                              <Container className="max-w-[640px] bg-rc-container mx-auto">
                                    {/* Header */}
                                    <Section className="bg-rc-light">
                                          <Row>
                                                <Column className="py-5 px-6">
                                                      <Link href={URLS.website} target="_blank" className="no-underline">
                                                            <Img alt="Royal Constructions" src={URLS.logo} width={140} className="block outline-none border-none h-auto" />
                                                      </Link>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* Hero */}
                                    <Section
                                          className="mobile_px-4 mobile_pt-10 mobile_pb-8"
                                          style={{ padding: "3.5rem 1.5rem 2.5rem" }}
                                    >
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="text-rc-gold m-0 mb-4 text-[11px] leading-none tracking-[1.2px] uppercase"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 500 }}
                                                      >
                                                            Quotation
                                                      </Text>
                                                      <Text
                                                            className="mobile_font-40 text-rc-white m-0 mb-6 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 48,
                                                                  lineHeight: 1,
                                                                  letterSpacing: "-1.4px",
                                                            }}
                                                      >
                                                            Your Personalized
                                                            <br />
                                                            Quotation
                                                      </Text>
                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0"
                                                            style={{
                                                                  fontFamily: FONTS.body,
                                                                  fontWeight: 350,
                                                                  fontSize: 14,
                                                                  lineHeight: 1.7,
                                                                  letterSpacing: "0.3px",
                                                                  maxWidth: 460,
                                                            }}
                                                      >
                                                            Dear {name}, please find below your personalized quotation
                                                            for{" "}
                                                            <span className="text-rc-white" style={{ fontWeight: 450 }}>
                                                                  {project}
                                                            </span>{" "}
                                                            at{" "}
                                                            <span className="text-rc-white" style={{ fontWeight: 450 }}>
                                                                  {location}
                                                            </span>
                                                            .
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* Quote Summary Card */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "0 1.5rem 2.5rem" }}
                                    >
                                          <Row>
                                                <Column
                                                      className="bg-rc-card rounded-md overflow-hidden"
                                                      style={{ border: "1px solid #1B2D45" }}
                                                >
                                                      {/* Card Header */}
                                                      <Row>
                                                            <Column className="bg-rc-gold py-3.5 px-6">
                                                                  <Text
                                                                        className="text-rc-container m-0 uppercase text-[13px] leading-none tracking-[0.6px]"
                                                                        style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}
                                                                  >
                                                                        Quote Summary
                                                                  </Text>
                                                            </Column>
                                                      </Row>

                                                      <QuoteRow label="Project Type" value={type} showBorder />
                                                      <QuoteRow label="Total Cost" value={amount} isAmount showBorder />
                                                      <QuoteRow label="Estimated Duration" value={duration} />
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* How to Proceed */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "1rem 1.5rem 2.5rem" }}
                                    >
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="mobile_font-24 text-rc-white m-0 mb-8 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 28,
                                                                  lineHeight: 0.9,
                                                                  letterSpacing: "0.3px",
                                                            }}
                                                      >
                                                            How to proceed
                                                      </Text>

                                                      <ProceedStep
                                                            num="1"
                                                            title="Review Your Quotation"
                                                            description="Carefully review all project details, specifications, and costs outlined in the attached quotation document."
                                                            showBorder
                                                      />

                                                      <ProceedStep
                                                            num="2"
                                                            title="Approve the Quote"
                                                            description={
                                                                  <>
                                                                        Click the{" "}
                                                                        <span
                                                                              className="text-rc-gold"
                                                                              style={{ fontWeight: 450 }}
                                                                        >
                                                                              APPROVE
                                                                        </span>{" "}
                                                                        button below to confirm your acceptance and move forward.
                                                                  </>
                                                            }
                                                            showBorder
                                                      />

                                                      <ProceedStep
                                                            num="3"
                                                            title="Upload Signed Copy"
                                                            description="Upload the signed quotation using the link provided after approval to finalize your project."
                                                            showBorder={false}
                                                      />
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* Approve CTA */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "0 1.5rem 2.5rem" }}
                                    >
                                          <Row>
                                                <Column className="text-center">
                                                      <Button
                                                            href={approveUrl}
                                                            target="_blank"
                                                            className="bg-rc-gold text-rc-container no-underline uppercase tracking-[1px]"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 15,
                                                                  lineHeight: 1,
                                                                  padding: "1rem 3rem",
                                                                  borderRadius: 4,
                                                            }}
                                                      >
                                                            Approve Quotation
                                                      </Button>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* Validity Notice */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "0 1.5rem 3rem" }}
                                    >
                                          <Row>
                                                <Column className="bg-rc-card rounded border-l-[3px] border-l-rc-gold">
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text
                                                                              className="text-rc-gold m-0 text-[13px] leading-relaxed tracking-[0.2px]"
                                                                              style={{ fontFamily: FONTS.body, fontWeight: 400 }}
                                                                        >
                                                                              This quotation is valid for{" "}
                                                                              <span
                                                                                    className="text-rc-white"
                                                                                    style={{ fontWeight: 500 }}
                                                                              >
                                                                                    14 days
                                                                              </span>{" "}
                                                                              from the date of this email. Please ensure approval
                                                                              within this period to lock in your pricing.
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* Questions */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "0 1.5rem 2.5rem" }}
                                    >
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="text-rc-white m-0 mb-1 text-[15px] leading-relaxed tracking-[-0.075px]"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 450 }}
                                                      >
                                                            Questions about your quote?
                                                      </Text>
                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 300, maxWidth: 490 }}
                                                      >
                                                            Reach out at{" "}
                                                            <Link href="mailto:info@royalconstructions.com.au" className="text-rc-gold no-underline">
                                                                  info@royalconstructions.com.au
                                                            </Link>{" "}
                                                            or call{" "}
                                                            <Link href="tel:1300832355" className="text-rc-gold no-underline">
                                                                  1300 832 355
                                                            </Link>
                                                            . We're happy to walk through any details.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* Sign-off */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "0 1.5rem 3rem" }}
                                    >
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

                                    {/* Footer */}
                                    <Footer />
                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}
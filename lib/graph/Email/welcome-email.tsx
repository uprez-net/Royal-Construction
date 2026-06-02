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
            "https://royalconstructions.com.au/wp-content/smush-webp/2026/04/main-4-1024x683.png.webp",
      facebook: "https://royal-construction-chi.vercel.app/facebook.svg",
      instagram: "https://royal-construction-chi.vercel.app/instagram.svg",
      mbaLogo: "https://royal-construction-chi.vercel.app/image-78.png",
      oranPark:
            "https://royalconstructions.com.au/wp-content/smush-webp/2026/03/Horizontal-secondary-lockup-1.png.webp",
      website: "https://royalconstructions.com.au/",
      contact: "https://royalconstructions.com.au/contact/",
      facebookPage: "https://www.facebook.com/royalconstructionsau/",
      instagramPage: "https://www.instagram.com/royalconstructionsau/",
};

const PROJECT_BRIEF_ITEMS = [
      {
            title: "Land information",
            description: "Let us know whether you already own the land, are reviewing a block, or are still searching.",
      },
      {
            title: "Project priorities",
            description: "Share what matters most to you, such as layout, finishes, number of rooms, outdoor space, or energy efficiency.",
      },
      {
            title: "Build type",
            description: "Tell us if this is a new home, duplex, knockdown rebuild, extension, renovation, or another build type.",
      },
      {
            title: "Location or address",
            description: "Provide the suburb, lot details, or full site address if you already have it.",
      },
      {
            title: "Timeline",
            description: "Share when you would like to start design, approvals, construction, or move in.",
      },
      {
            title: "Existing documents and ideas",
            description: "Send any plans, surveys, council notes, inspiration images, sketches, or design ideas you already have.",
      },
];

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

// ─── Step Sub-Component ─────────────────────────────────────────────────────

function Step({
      number,
      title,
      description,
      showBorder = true,
}: {
      number: string;
      title: string;
      description: string;
      showBorder?: boolean;
}) {
      return (
            <Section
                  className="mobile_px-4 mobile_py-8"
                  style={{
                        padding: "2.5rem 1.5rem",
                        borderBottom: showBorder ? "1px solid #1B2D45" : undefined,
                  }}
            >
                  <Row>
                        <Column className="pt-[3px]" style={{ width: 44, verticalAlign: "top" }}>
                              <Text
                                    className="text-[22px] leading-none font-medium text-rc-gold m-0"
                                    style={{ fontFamily: FONTS.condensed }}
                              >
                                    {number}
                              </Text>
                        </Column>

                        <Column className="pl-3">
                              <Text
                                    className="text-lg leading-tight font-medium text-rc-white m-0 mb-2"
                                    style={{ fontFamily: FONTS.condensed }}
                              >
                                    {title}
                              </Text>
                              <Text
                                    className="text-sm leading-relaxed tracking-[0.3px] font-light text-rc-text m-0"
                                    style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                              >
                                    {description}
                              </Text>
                        </Column>
                  </Row>
            </Section>
      );
}

// ─── Get Started Card Sub-Component ─────────────────────────────────────────

function GetStartedCard({
      title,
      description,
      linkLabel,
      linkHref,
      showBorder = true,
}: {
      title: string;
      description: string;
      linkLabel: string;
      linkHref: string;
      showBorder?: boolean;
}) {
      return (
            <Section
                  className="mobile_py-8"
                  style={{
                        padding: "2.5rem 0",
                        borderBottom: showBorder ? "1px solid #1B2D45" : undefined,
                  }}
            >
                  <Row>
                        <Column>
                              <Text
                                    className="text-xl leading-tight font-medium text-rc-white m-0 mb-3"
                                    style={{ fontFamily: FONTS.condensed }}
                              >
                                    {title}
                              </Text>
                              <Text
                                    className="text-sm leading-relaxed tracking-[0.3px] text-rc-text m-0 mb-4"
                                    style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                              >
                                    {description}
                              </Text>
                              <Link
                                    href={linkHref}
                                    target="_blank"
                                    className="text-rc-gold no-underline text-[15px] leading-relaxed tracking-[-0.075px]"
                                    style={{ fontFamily: FONTS.body, fontWeight: 450 }}
                              >
                                    {linkLabel}&nbsp;→
                              </Link>
                        </Column>
                  </Row>
            </Section>
      );
}

function AppointmentBookingCard({ bookingUrl }: { bookingUrl: string }) {
      return (
            <Section
                  className="mobile_px-4 mobile_pt-10"
                  style={{ padding: "3rem 1.5rem 0" }}
            >
                  <Row>
                        <Column className="bg-rc-card rounded border border-rc-gold" style={{ padding: "1.5rem" }}>
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
                                    First action
                              </Text>
                              <Text
                                    className="mobile_font-24 text-rc-white m-0 mb-4 uppercase"
                                    style={{
                                          fontFamily: FONTS.condensed,
                                          fontWeight: 500,
                                          fontSize: 30,
                                          lineHeight: 1,
                                          letterSpacing: "0.4px",
                                    }}
                              >
                                    Book your appointment with the builder
                              </Text>
                              <Text
                                    className="text-sm leading-relaxed tracking-[0.3px] text-rc-text m-0 mb-5"
                                    style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                              >
                                    Please use the link below to add a consultation to the builder calendar.
                                    This gives the team a fixed time to review your project and answer your
                                    questions.
                              </Text>
                              <Link
                                    href={bookingUrl}
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
                                    Book Appointment
                              </Link>
                              <Text
                                    className="text-rc-muted m-0 mt-4 text-[12px] leading-relaxed tracking-[0.2px]"
                                    style={{ fontFamily: FONTS.body, fontWeight: 300 }}
                              >
                                    If no suitable time is available, reply to this email and we will help arrange one.
                              </Text>
                        </Column>
                  </Row>
            </Section>
      );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface WelcomeEmailProps {
      name?: string;
      bookingUrl?: string;
}

export default function WelcomeEmail({ name = "Homeowner", bookingUrl = URLS.contact }: WelcomeEmailProps) {
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
                                    Thanks for your interest in Royal Constructions - send your project
                                    details and book a builder calendar slot.
                                    <div>
                                          &nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏
                                    </div>
                              </div>

                              {/* ── Main Container ── */}
                              <Container className="max-w-[640px] bg-rc-container mx-auto">
                                    {/* ── Logo Header ── */}
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

                                    {/* ── Hero Section ── */}
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
                                                            Welcome to
                                                            <br />
                                                            Royal Constructions
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
                                                            Dear {name}, thank you for your interest in building with
                                                            Royal Constructions. The next step is to book an appointment
                                                            with the builder, then reply with any project ideas you
                                                            already have so we can prepare before your consultation.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Hero Image ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Img
                                                            alt="Luxury Home by Royal Constructions"
                                                            src={URLS.heroImage}
                                                            width={592}
                                                            className="block outline-none border-none no-underline w-full max-w-[592px] rounded"
                                                      />
                                                </Column>
                                          </Row>
                                    </Section>

                                    <AppointmentBookingCard bookingUrl={bookingUrl} />

                                    {/* ── Project Details Request ── */}
                                    <Section
                                          className="mobile_px-4 mobile_pt-10"
                                          style={{ padding: "2rem 1.5rem 0" }}
                                    >
                                          <Row>
                                                <Column className="bg-rc-card rounded border border-rc-border" style={{ padding: "1.5rem" }}>
                                                      <Text
                                                            className="mobile_font-24 text-rc-white m-0 mb-4 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 28,
                                                                  lineHeight: 1,
                                                                  letterSpacing: "0.4px",
                                                            }}
                                                      >
                                                            Before your appointment
                                                      </Text>
                                                      <Text
                                                            className="text-sm leading-relaxed tracking-[0.3px] text-rc-text m-0 mb-4"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                                                      >
                                                            Please reply with whatever details you already have so
                                                            we can prepare for the consultation. It is okay if some
                                                            items are still undecided.
                                                      </Text>
                                                      {PROJECT_BRIEF_ITEMS.map((item) => (
                                                            <Text
                                                                  key={item.title}
                                                                  className="text-sm leading-relaxed tracking-[0.2px] text-rc-text m-0 mb-3"
                                                                  style={{ fontFamily: FONTS.body, fontWeight: 350 }}
                                                            >
                                                                  <span className="text-rc-gold" style={{ fontWeight: 500 }}>
                                                                        {item.title}:
                                                                  </span>{" "}
                                                                  {item.description}
                                                            </Text>
                                                      ))}
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── "What Happens Next" Heading ── */}
                                    <Section
                                          className="mobile_px-4 mobile_pt-10"
                                          style={{ padding: "4rem 1.5rem 0" }}
                                    >
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="mobile_font-24 text-rc-white m-0 mb-10 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 32,
                                                                  lineHeight: 0.9,
                                                                  letterSpacing: "0.4px",
                                                            }}
                                                      >
                                                            What happens next
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Steps ── */}
                                    <Step
                                          number="01"
                                          title="Share Your Project Details"
                                          description="Reply with whatever details you already have so the builder can review them before the appointment."
                                          showBorder
                                    />
                                    <Step
                                          number="02"
                                          title="Meet With the Builder"
                                          description="Use the consultation to discuss your goals, site details, priorities, and preferred timeline."
                                          showBorder
                                    />
                                    <Step
                                          number="03"
                                          title="Review the Next Steps"
                                          description="Our team will review your information, clarify anything missing, and guide you through design, quotation, and approval next steps."
                                          showBorder={false}
                                    />

                                    {/* ── 24 Hour Notice ── */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "0.5rem 1.5rem 3rem" }}
                                    >
                                          <Row>
                                                <Column
                                                      className="bg-rc-card rounded border-l-[3px] border-l-rc-gold"
                                                >
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text
                                                                              className="text-rc-gold m-0 text-[13px] leading-relaxed tracking-[0.2px]"
                                                                              style={{ fontFamily: FONTS.body, fontWeight: 400 }}
                                                                        >
                                                                              The booking button above is the appointment action.
                                                                              These next steps show how we prepare once your time is
                                                                              reserved.
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Get Started Section ── */}
                                    <Section
                                          className="mobile_px-4 mobile_pb-10"
                                          style={{ padding: "0 1.5rem 3.5rem" }}
                                    >
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="mobile_font-24 text-rc-white m-0 mb-2 uppercase"
                                                            style={{
                                                                  fontFamily: FONTS.condensed,
                                                                  fontWeight: 500,
                                                                  fontSize: 32,
                                                                  lineHeight: 0.9,
                                                                  letterSpacing: "0.4px",
                                                            }}
                                                      >
                                                            Get started
                                                      </Text>

                                                      <GetStartedCard
                                                            title="Explore Our Portfolio"
                                                            description="Browse completed projects across NSW for inspiration and ideas for your new home."
                                                            linkLabel="View Projects"
                                                            linkHref={"https://royalconstructions.com.au/projects/"}
                                                            showBorder
                                                      />

                                                      <GetStartedCard
                                                            title="Contact the Team"
                                                            description="Have a question before your appointment? Reply to this email or contact our office."
                                                            linkLabel="Email Us"
                                                            linkHref="mailto:info@royalconstructions.com.au"
                                                            showBorder={false}
                                                      />

                                                      {/* ── Need Help ── */}
                                                      <Section className="pt-10">
                                                            <Row>
                                                                  <Column>
                                                                        <Text
                                                                              className="text-rc-white m-0 mb-0.5 text-[15px] leading-relaxed tracking-[-0.075px]"
                                                                              style={{ fontFamily: FONTS.body, fontWeight: 450 }}
                                                                        >
                                                                              Questions?
                                                                        </Text>
                                                                        <Text
                                                                              className="mobile_max-w-full text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]"
                                                                              style={{
                                                                                    fontFamily: FONTS.body,
                                                                                    fontWeight: 300,
                                                                                    maxWidth: 490,
                                                                              }}
                                                                        >
                                                                              Our team is here to help. Reach out at{" "}
                                                                              <Link
                                                                                    href="mailto:info@royalconstructions.com.au"
                                                                                    className="text-rc-gold no-underline"
                                                                              >
                                                                                    info@royalconstructions.com.au
                                                                              </Link>{" "}
                                                                              or call{" "}
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

                                    {/* ── Sign-off ── */}
                                    <Section
                                          className="mobile_px-4"
                                          style={{ padding: "0 1.5rem 3rem" }}
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
                 FOOTER
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
                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}

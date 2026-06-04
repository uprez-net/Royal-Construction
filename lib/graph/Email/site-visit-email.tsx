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
import {
      FONTS,
      RC_URLS,
      RESPONSIVE_CSS,
      FONT_FACES_CSS,
      TAILWIND_CONFIG,
} from "./email-theme";
import { EmailFooter } from "./email-footer";
import { EmailHeader } from "./email-header";

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
      calendar: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E`,
      clock: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
      pin: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'%3E%3C/path%3E%3Ccircle cx='12' cy='10' r='3'%3E%3C/circle%3E%3C/svg%3E`,
      check: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E`,
};

// ─── Responsive + Font Styles ───────────────────────────────────────────────

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
                  <Column className="py-5 px-6">
                        <Row>
                              <Column className="pt-[2px]" style={{ width: 36, verticalAlign: "top" }}>
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

function ExpectItem({
      title,
      description,
      showBorder = true,
}: {
      title: string;
      description: string;
      showBorder?: boolean;
}) {
      return (
            <Row
                  style={{
                        borderBottom: showBorder ? "1px solid #1B2D45" : undefined,
                        paddingBottom: showBorder ? "1.5rem" : 0,
                        marginBottom: showBorder ? "1.5rem" : 0,
                  }}
            >
                  <Column className="pt-[2px]" style={{ width: 36, verticalAlign: "top" }}>
                        <Img alt="" height={18} src={ICONS.check} width={18} className="block outline-none border-none" />
                  </Column>
                  <Column className="pl-3">
                        <Text className="m-0" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1.3, color: "#FFFFFF" }}>
                              {title}
                        </Text>
                        <Text
                              className="m-0 mt-1.5"
                              style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 13, lineHeight: 1.5, letterSpacing: "0.2px", color: "#7E93AB" }}
                        >
                              {description}
                        </Text>
                  </Column>
            </Row>
      );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface SiteVisitEmailProps {
      name?: string;
      date?: string;
      time?: string;
      location?: string;
      calendarUrl?: string;
}

export default function SiteVisitEmail({
      name = "Client",
      date = "TBD",
      time = "TBD",
      location = "TBD",
      calendarUrl = RC_URLS.bookConsultation,
}: SiteVisitEmailProps) {
      return (
            <Tailwind config={TAILWIND_CONFIG}>
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
                                    Your site visit is confirmed — review the details and what to expect
                                    <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
                              </div>

                              <Container className="max-w-[640px] bg-rc-container mx-auto">

                                    <EmailHeader />

                                    {/* ── Hero ── */}
                                    <Section className="mobile_px-4 mobile_pt-10" style={{ padding: "3.5rem 1.5rem 2rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="text-rc-gold m-0 mb-4 text-[11px] leading-none tracking-[1.2px] uppercase"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 500 }}
                                                      >
                                                            Meeting Confirmation
                                                      </Text>
                                                      <Text
                                                            className="mobile_font-40 text-rc-white m-0 uppercase"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 48, lineHeight: 1, letterSpacing: "-1.4px" }}
                                                      >
                                                            Site Visit
                                                            <br />
                                                            Confirmed
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Intro ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text className="text-rc-text m-0 mb-5" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px" }}>
                                                            Dear {name},
                                                      </Text>
                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px", maxWidth: 480 }}
                                                      >
                                                            This confirms your site visit has been scheduled. Please review the details below and ensure the site is accessible at the designated time.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Event Details Card ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded-md overflow-hidden" style={{ border: "1px solid #1B2D45" }}>

                                                      {/* Card Header */}
                                                      <Row>
                                                            <Column className="bg-rc-gold py-3.5 px-6">
                                                                  <Text
                                                                        className="text-rc-container m-0 uppercase text-[13px] leading-none tracking-[0.6px]"
                                                                        style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}
                                                                  >
                                                                        Appointment Details
                                                                  </Text>
                                                            </Column>
                                                      </Row>

                                                      <DetailRow icon={ICONS.calendar} label="Date" value={date} showBorder />
                                                      <DetailRow icon={ICONS.clock} label="Time" value={time} showBorder />
                                                      <DetailRow icon={ICONS.pin} label="Location" value={location} showBorder={false} />

                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── What to Expect ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="mobile_font-24 text-rc-white m-0 mb-8 uppercase"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 28, lineHeight: 0.9, letterSpacing: "0.3px" }}
                                                      >
                                                            What to expect
                                                      </Text>

                                                      <ExpectItem
                                                            title="Site Assessment"
                                                            description="Our team will evaluate the site conditions, topography, and any factors that may influence the build."
                                                            showBorder
                                                      />
                                                      <ExpectItem
                                                            title="Measurement Taking"
                                                            description="Precise measurements will be recorded to ensure accurate planning and quotation."
                                                            showBorder
                                                      />
                                                      <ExpectItem
                                                            title="Initial Design Discussion"
                                                            description="We'll discuss your layout preferences, must-haves, and design inspirations on-site."
                                                            showBorder
                                                      />
                                                      <ExpectItem
                                                            title="Q&A Session"
                                                            description="An open floor to ask any questions about the build process, timelines, or next steps."
                                                            showBorder={false}
                                                      />

                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Add to Calendar CTA ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column className="text-center">
                                                      <Button
                                                            href={calendarUrl}
                                                            target="_blank"
                                                            className="bg-rc-gold text-rc-container no-underline uppercase tracking-[1px]"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1, padding: "1rem 2.5rem", borderRadius: 4 }}
                                                      >
                                                            Add to Calendar
                                                      </Button>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Important Notice ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded border-l-[3px] border-l-rc-gold">
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text className="text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]" style={{ fontFamily: FONTS.body, fontWeight: 400 }}>
                                                                              Please ensure{" "}
                                                                              <span className="text-rc-white" style={{ fontWeight: 450 }}>someone is available at the site</span>{" "}
                                                                              during the scheduled time so our team can conduct a thorough assessment.
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Need to Reschedule ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="text-rc-white m-0 mb-1 text-[15px] leading-relaxed tracking-[-0.075px]"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 450 }}
                                                      >
                                                            Need to reschedule?
                                                      </Text>
                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 300, maxWidth: 490 }}
                                                      >
                                                            No worries — simply reply to this email or call us at{" "}
                                                            <Link href="tel:1300832355" className="text-rc-gold no-underline">1300 832 355</Link>{" "}
                                                            and we&apos;ll find a time that works.
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
                                    <EmailFooter />

                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}
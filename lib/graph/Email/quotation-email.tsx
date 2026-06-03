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
import {
      FONTS,
      RC_URLS,
      RC_URLS_APP,
      RESPONSIVE_CSS,
      FONT_FACES_CSS,
      TAILWIND_CONFIG,
} from "./email-theme";
import { EmailFooter } from "./email-footer";
import { EmailHeader } from "./email-header";

// ─── Responsive + Font Styles ───────────────────────────────────────────────

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
                  style={{ borderBottom: showBorder ? "1px solid #1A2A42" : undefined }}
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
      approveUrl = RC_URLS.bookConsultation,
}: QuotationEmailProps) {
      return (
            <Tailwind config={TAILWIND_CONFIG}>
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
                                    <EmailHeader />

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
                                    <EmailFooter />
                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}
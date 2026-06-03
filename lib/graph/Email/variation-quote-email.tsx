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

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
      trend: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='23 6 13.5 15.5 8.5 10.5 1 18'%3E%3C/polyline%3E%3Cpolyline points='17 6 23 6 23 12'%3E%3C/polyline%3E%3C/svg%3E`,
};

// ─── Responsive + Font Styles ───────────────────────────────────────────────

// ─── Main Component ─────────────────────────────────────────────────────────

interface VariationQuoteEmailProps {
      name?: string;
      project?: string;
      originalAmount?: string;
      variationAmount?: string;
      revisedAmount?: string;
      approveUrl?: string;
}

export default function VariationQuoteEmail({
      name = "Client",
      project = "Your Project",
      originalAmount = "$0",
      variationAmount = "$0",
      revisedAmount = "$0",
      approveUrl = RC_URLS.bookConsultation,
}: VariationQuoteEmailProps) {
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
                                    Your quotation has been updated — review the variation and approve to proceed
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
                                                            Variation
                                                      </Text>
                                                      <Text
                                                            className="mobile_font-40 text-rc-white m-0 uppercase"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 48, lineHeight: 1, letterSpacing: "-1.4px" }}
                                                      >
                                                            Quotation
                                                            <br />
                                                            Update
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
                                                            Following your recent selections from our catalogue, there are some variations to the original quotation for{" "}
                                                            <span className="text-rc-white" style={{ fontWeight: 450 }}>{project}</span>. Please review the updated breakdown below.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Variation Comparison Card ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded-md overflow-hidden" style={{ border: "1px solid #1B2D45" }}>

                                                      {/* Card Header */}
                                                      <Row>
                                                            <Column className="bg-rc-gold py-3.5 px-6">
                                                                  <Text
                                                                        className="text-rc-container m-0 uppercase text-[13px] leading-none tracking-[0.6px]"
                                                                        style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}
                                                                  >
                                                                        Variation Summary
                                                                  </Text>
                                                            </Column>
                                                      </Row>

                                                      {/* Row 1 — Original Quote */}
                                                      <Row className="border-b border-rc-border">
                                                            <Column className="py-5 px-6">
                                                                  <Row>
                                                                        <Column className="mobile_amount_stack" style={{ width: "50%", verticalAlign: "middle" }}>
                                                                              <Text className="text-rc-label m-0 uppercase text-xs leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                                                                                    Original Quote
                                                                              </Text>
                                                                        </Column>
                                                                        <Column className="mobile_amount_stack text-right">
                                                                              <Text
                                                                                    className="m-0"
                                                                                    style={{
                                                                                          fontFamily: FONTS.condensed,
                                                                                          fontWeight: 500,
                                                                                          fontSize: 18,
                                                                                          lineHeight: 1.2,
                                                                                          color: "#B0BFCF",
                                                                                          textDecoration: "line-through",
                                                                                          textDecorationColor: "#6B7F9E",
                                                                                    }}
                                                                              >
                                                                                    {originalAmount}
                                                                              </Text>
                                                                        </Column>
                                                                  </Row>
                                                            </Column>
                                                      </Row>

                                                      {/* Row 2 — Variation Amount */}
                                                      <Row className="border-b border-rc-border bg-rc-cardAlt">
                                                            <Column className="py-5 px-6">
                                                                  <Row>
                                                                        <Column className="mobile_amount_stack" style={{ width: "50%", verticalAlign: "middle" }}>
                                                                              <Row>
                                                                                    <Column className="pr-2" style={{ width: 20 }} verticalAlign="middle">
                                                                                          <Img alt="" height={16} src={ICONS.trend} width={16} className="block outline-none border-none" />
                                                                                    </Column>
                                                                                    <Column verticalAlign="middle">
                                                                                          <Text className="text-rc-gold m-0 uppercase text-xs leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                                                                                                Variation
                                                                                          </Text>
                                                                                    </Column>
                                                                              </Row>
                                                                        </Column>
                                                                        <Column className="mobile_amount_stack text-right">
                                                                              <Text className="m-0" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 20, lineHeight: 1.2, color: "#C6923A" }}>
                                                                                    + {variationAmount}
                                                                              </Text>
                                                                        </Column>
                                                                  </Row>
                                                            </Column>
                                                      </Row>

                                                      {/* Row 3 — Revised Total */}
                                                      <Row>
                                                            <Column className="py-6 px-6">
                                                                  <Row>
                                                                        <Column className="mobile_amount_stack" style={{ width: "50%", verticalAlign: "middle" }}>
                                                                              <Text className="text-rc-white m-0 uppercase text-[13px] leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 450 }}>
                                                                                    Revised Total
                                                                              </Text>
                                                                        </Column>
                                                                        <Column className="mobile_amount_stack text-right">
                                                                              <Text className="m-0" style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 28, lineHeight: 1, color: "#FFFFFF" }}>
                                                                                    {revisedAmount}
                                                                              </Text>
                                                                        </Column>
                                                                  </Row>
                                                            </Column>
                                                      </Row>

                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── What Changed Notice ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded border-l-[3px] border-l-rc-gold">
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text className="text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]" style={{ fontFamily: FONTS.body, fontWeight: 400 }}>
                                                                              This variation reflects your recent material and finish selections. As always, we're happy to{" "}
                                                                              <span className="text-rc-gold" style={{ fontWeight: 450 }}>walk you through</span> any changes in detail.
                                                                        </Text>
                                                                  </Column>
                                                            </Row>
                                                      </Section>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Approve CTA ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column className="text-center">
                                                      <Button
                                                            href={approveUrl}
                                                            target="_blank"
                                                            className="bg-rc-gold text-rc-container no-underline uppercase tracking-[1px]"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1, padding: "1rem 3rem", borderRadius: 4 }}
                                                      >
                                                            Approve Variation
                                                      </Button>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Signed Copy Notice ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="text-center">
                                                      <Text className="text-rc-label m-0 text-xs leading-relaxed tracking-[0.3px]" style={{ fontFamily: FONTS.body, fontWeight: 300 }}>
                                                            A signed copy of the updated quotation is required to proceed with your project.
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
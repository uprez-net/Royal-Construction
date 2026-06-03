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
      RESPONSIVE_CSS,
      FONT_FACES_CSS,
      TAILWIND_CONFIG,
} from "./email-theme";
import { EmailFooter } from "./email-footer";
import { EmailHeader } from "./email-header";

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
      chat: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'%3E%3C/path%3E%3C/svg%3E`,
};

// ─── Main Component ─────────────────────────────────────────────────────────

interface FollowUpEmailProps {
      name?: string;
      type?: string;
      location?: string;
      notes?: string;
      scheduleCallUrl?: string;
}

export default function FollowUpEmail({
      name = "Homeowner",
      type = "New Home Build",
      location = "NSW",
      notes = "Discussed initial design preferences, block orientation, and budget expectations for the project.",
      scheduleCallUrl = RC_URLS.bookConsultation,
}: FollowUpEmailProps) {
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
                                    Following up on your project — let's take the next step together
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
                                                            Follow-up
                                                      </Text>
                                                      <Text
                                                            className="mobile_font-40 text-rc-white m-0 uppercase"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 48, lineHeight: 1, letterSpacing: "-1.4px" }}
                                                      >
                                                            Let's Keep the
                                                            <br />
                                                            Momentum Going
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Personal Message ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0.5rem 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text className="text-rc-text m-0 mb-5" style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px" }}>
                                                            Dear {name},
                                                      </Text>
                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px", maxWidth: 480 }}
                                                      >
                                                            I wanted to follow up on our recent conversation regarding your{" "}
                                                            <span className="text-rc-white" style={{ fontWeight: 450 }}>{type}</span> project at{" "}
                                                            <span className="text-rc-white" style={{ fontWeight: 450 }}>{location}</span>. It was great connecting with you and learning more about your vision.
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Discussion Notes Card ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded-md overflow-hidden" style={{ border: "1px solid #1B2D45" }}>
                                                      {/* Card Header */}
                                                      <Row className="border-b border-rc-border">
                                                            <Column className="py-4 px-6">
                                                                  <Row>
                                                                        <Column className="pr-2.5" style={{ width: 24 }} verticalAlign="middle">
                                                                              <Img alt="" height={18} src={ICONS.chat} width={18} className="block outline-none border-none" />
                                                                        </Column>
                                                                        <Column verticalAlign="middle">
                                                                              <Text
                                                                                    className="text-rc-gold m-0 uppercase text-xs leading-none tracking-[0.8px]"
                                                                                    style={{ fontFamily: FONTS.condensed, fontWeight: 500 }}
                                                                              >
                                                                                    What we discussed
                                                                              </Text>
                                                                        </Column>
                                                                  </Row>
                                                            </Column>
                                                      </Row>

                                                      {/* Notes Content */}
                                                      <Row>
                                                            <Column className="py-5 px-6">
                                                                  <Text
                                                                        className="text-rc-highlight m-0"
                                                                        style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.2px" }}
                                                                  >
                                                                        {notes}
                                                                  </Text>
                                                            </Column>
                                                      </Row>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Quick Call CTA Text ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 2.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Text
                                                            className="mobile_max-w-full text-rc-text m-0 mb-6"
                                                            style={{ fontFamily: FONTS.body, fontWeight: 350, fontSize: 14, lineHeight: 1.7, letterSpacing: "0.3px", maxWidth: 480 }}
                                                      >
                                                            I'd love to answer any questions you might have and help move things forward. Would you be available for a quick call this week?
                                                      </Text>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Schedule Call Button ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 1.5rem" }}>
                                          <Row>
                                                <Column className="text-center">
                                                      <Button
                                                            href={scheduleCallUrl}
                                                            target="_blank"
                                                            className="bg-rc-gold text-rc-container no-underline uppercase tracking-[1px]"
                                                            style={{ fontFamily: FONTS.condensed, fontWeight: 500, fontSize: 15, lineHeight: 1, padding: "1rem 2.5rem", borderRadius: 4 }}
                                                      >
                                                            Schedule a Call
                                                      </Button>
                                                </Column>
                                          </Row>
                                    </Section>

                                    {/* ── Encouragement Note ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem 3rem" }}>
                                          <Row>
                                                <Column className="bg-rc-card rounded border-l-[3px] border-l-rc-gold">
                                                      <Section className="py-4 px-5">
                                                            <Row>
                                                                  <Column>
                                                                        <Text className="text-rc-text m-0 text-[13px] leading-relaxed tracking-[0.2px]" style={{ fontFamily: FONTS.body, fontWeight: 400 }}>
                                                                              Building a home is a big decision — there's{" "}
                                                                              <span className="text-rc-gold" style={{ fontWeight: 450 }}>no rush</span> and{" "}
                                                                              <span className="text-rc-gold" style={{ fontWeight: 450 }}>no pressure</span>. We're here whenever you're ready to take the next step.
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
                                                            Best regards,
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

                                    <EmailFooter />

                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}
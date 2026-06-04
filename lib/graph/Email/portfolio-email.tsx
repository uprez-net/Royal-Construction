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

export default function PortfolioEmail({}: PortfolioEmailProps) {
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
                                    <EmailHeader />

                                    {/* ── Hero Image ── */}
                                    <Section className="mobile_px-4" style={{ padding: "0 1.5rem" }}>
                                          <Row>
                                                <Column>
                                                      <Img
                                                            alt="Royal Constructions Portfolio"
                                                            src={RC_URLS.heroPortfolio}
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
                                                            href={RC_URLS_APP.builderProfile}
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
                                                                              your project, simply reply to this email.
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

                                    <EmailFooter />
                              </Container>
                        </Body>
                  </Html>
            </Tailwind>
      );
}

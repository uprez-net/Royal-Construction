import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Text,
  Img,
  Tailwind,
} from '@react-email/components';
import {
  FONTS,
  RC_URLS,
  RC_COLORS,
  RESPONSIVE_CSS,
  FONT_FACES_CSS,
  TAILWIND_CONFIG,
} from './email-theme';
import { EmailFooter } from './email-footer';
import { EmailHeader } from './email-header';
import { EmailCtaButton } from './email-cta-button';
import { EmailSectionLight } from './email-section-light';
import { EmailSectionWhite } from './email-section-white';

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────

const ICONS = {
  trend: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='23 6 13.5 15.5 8.5 10.5 1 18'%3E%3C/polyline%3E%3Cpolyline points='17 6 23 6 23 12'%3E%3C/polyline%3E%3C/svg%3E`,
};

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
  name = 'Client',
  project = 'Your Project',
  originalAmount = '$0',
  variationAmount = '$0',
  revisedAmount = '$0',
  approveUrl = RC_URLS.website,
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

        <Body
          className="m-0 p-0"
          style={{
            fontFamily: FONTS.body,
            fontWeight: 350,
            fontSize: 14,
            backgroundColor: RC_COLORS.light,
            margin: 0,
          }}
        >
          <div className="hidden overflow-hidden leading-none opacity-none max-h-0 max-w-0">
            Your quotation has been updated — review the variation and approve to proceed
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <Container className="max-w-[640px] mx-auto" style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}>
            <EmailHeader showGoldBar />

            {/* ── Hero ── */}
            <EmailSectionLight style={{ padding: '2.5rem 1.5rem 2rem' }}>
              <Text
                className="m-0 mb-4 uppercase"
                style={{
                  fontFamily: FONTS.body,
                  fontWeight: 500,
                  fontSize: 11,
                  lineHeight: 1,
                  letterSpacing: '1.2px',
                  color: RC_COLORS.gold,
                }}
              >
                Variation
              </Text>
              <Text
                className="mobile_font-40 m-0 uppercase"
                style={{
                  fontFamily: FONTS.condensed,
                  fontWeight: 500,
                  fontSize: 48,
                  lineHeight: 1,
                  letterSpacing: '-1.4px',
                  color: RC_COLORS.textOnLight,
                }}
              >
                Quotation
                <br />
                Update
              </Text>
            </EmailSectionLight>

            {/* ── Intro ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2.5rem' }}>
              <Row>
                <Column>
                  <Text
                    className="m-0 mb-5"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 350,
                      fontSize: 14,
                      lineHeight: 1.7,
                      letterSpacing: '0.3px',
                      color: RC_COLORS.textMutedOnLight,
                    }}
                  >
                    Dear {name},
                  </Text>
                  <Text
                    className="mobile_max-w-full m-0"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 350,
                      fontSize: 14,
                      lineHeight: 1.7,
                      letterSpacing: '0.3px',
                      color: RC_COLORS.textMutedOnLight,
                      maxWidth: 480,
                    }}
                  >
                    Following your recent selections from our catalogue, there are some variations to the original quotation for{' '}
                    <span style={{ fontWeight: 600, color: RC_COLORS.textOnLight }}>
                      {project}
                    </span>
                    . Please review the updated breakdown below.
                  </Text>
                </Column>
              </Row>
            </EmailSectionLight>

            {/* ── Variation Comparison Card ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Row>
                <Column
                  className="rounded-md overflow-hidden"
                  style={{ border: '1px solid #E2E8F0' }}
                >
                  {/* Card Header */}
                  <Row>
                    <Column style={{ backgroundColor: RC_COLORS.gold }}>
                      <Section className="py-3.5 px-6">
                        <Text
                          className="m-0 uppercase"
                          style={{
                            fontFamily: FONTS.condensed,
                            fontWeight: 500,
                            fontSize: 13,
                            lineHeight: 1,
                            letterSpacing: '0.6px',
                            color: '#FFFFFF',
                          }}
                        >
                          Variation Summary
                        </Text>
                      </Section>
                    </Column>
                  </Row>

                  {/* Row 1 — Original Quote */}
                  <Row style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <Column className="py-5 px-6">
                      <Row>
                        <Column
                          className="mobile_amount_stack"
                          style={{ width: '50%', verticalAlign: 'middle' }}
                        >
                          <Text
                            className="m-0 uppercase"
                            style={{
                              fontFamily: FONTS.body,
                              fontWeight: 500,
                              fontSize: 10,
                              letterSpacing: '0.8px',
                              color: RC_COLORS.textMutedOnLight,
                            }}
                          >
                            Original Quote
                          </Text>
                        </Column>
                        <Column className="mobile_amount_stack" style={{ textAlign: 'right' }}>
                          <Text
                            className="m-0"
                            style={{
                              fontFamily: FONTS.condensed,
                              fontWeight: 500,
                              fontSize: 18,
                              lineHeight: 1.2,
                              color: RC_COLORS.dimmed, // Lighter slate for crossed out
                              textDecoration: 'line-through',
                              textDecorationColor: RC_COLORS.dimmed,
                            }}
                          >
                            {originalAmount}
                          </Text>
                        </Column>
                      </Row>
                    </Column>
                  </Row>

                  {/* Row 2 — Variation Amount */}
                  <Row style={{ borderBottom: '1px solid #E2E8F0', backgroundColor: '#FDF6E3' }}> {/* Soft gold tint */}
                    <Column className="py-5 px-6">
                      <Row>
                        <Column
                          className="mobile_amount_stack"
                          style={{ width: '50%', verticalAlign: 'middle' }}
                        >
                          <Row>
                            <Column className="pr-2" style={{ width: 20, verticalAlign: 'middle' }}>
                              <Img alt="" height={16} src={ICONS.trend} width={16} className="block outline-none border-none" />
                            </Column>
                            <Column style={{ verticalAlign: 'middle' }}>
                              <Text
                                className="m-0 uppercase"
                                style={{
                                  fontFamily: FONTS.body,
                                  fontWeight: 500,
                                  fontSize: 10,
                                  letterSpacing: '0.8px',
                                  color: RC_COLORS.gold,
                                }}
                              >
                                Variation
                              </Text>
                            </Column>
                          </Row>
                        </Column>
                        <Column className="mobile_amount_stack" style={{ textAlign: 'right' }}>
                          <Text
                            className="m-0"
                            style={{
                              fontFamily: FONTS.condensed,
                              fontWeight: 500,
                              fontSize: 20,
                              lineHeight: 1.2,
                              color: RC_COLORS.gold,
                            }}
                          >
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
                        <Column
                          className="mobile_amount_stack"
                          style={{ width: '50%', verticalAlign: 'middle' }}
                        >
                          <Text
                            className="m-0 uppercase"
                            style={{
                              fontFamily: FONTS.body,
                              fontWeight: 600,
                              fontSize: 13,
                              letterSpacing: '0.3px',
                              color: RC_COLORS.textOnLight,
                            }}
                          >
                            Revised Total
                          </Text>
                        </Column>
                        <Column className="mobile_amount_stack" style={{ textAlign: 'right' }}>
                          <Text
                            className="m-0"
                            style={{
                              fontFamily: FONTS.condensed,
                              fontWeight: 500,
                              fontSize: 28,
                              lineHeight: 1,
                              color: RC_COLORS.textOnLight,
                            }}
                          >
                            {revisedAmount}
                          </Text>
                        </Column>
                      </Row>
                    </Column>
                  </Row>
                </Column>
              </Row>
            </EmailSectionWhite>

            {/* ── What Changed Notice ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  borderLeft: `3px solid ${RC_COLORS.gold}`,
                  padding: '1rem 1.25rem',
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="m-0"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 400,
                        fontSize: 13,
                        lineHeight: 1.65,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      This variation reflects your recent material and finish selections. As always, we&apos;re happy to{' '}
                      <span style={{ fontWeight: 600, color: RC_COLORS.gold }}>
                        walk you through
                      </span>{' '}
                      any changes in detail.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* ── Approve CTA ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Section style={{ textAlign: 'center' }}>
                <EmailCtaButton href={approveUrl} label="Approve Variation" align="center" />
              </Section>
            </EmailSectionWhite>

            {/* ── Signed Copy Notice ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2rem' }}>
              <Row>
                <Column className="text-center">
                  <Text
                    className="m-0"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 350,
                      fontSize: 12,
                      lineHeight: 1.5,
                      letterSpacing: '0.3px',
                      color: RC_COLORS.textMutedOnLight,
                    }}
                  >
                    A signed copy of the updated quotation is required to proceed with your project.
                  </Text>
                </Column>
              </Row>
            </EmailSectionLight>

            {/* ── Sign-off ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2.5rem' }}>
              <Section style={{ borderTop: '1px solid #E2E8F0', paddingTop: '1.5rem' }}>
                <Row>
                  <Column>
                    <Text
                      className="m-0 mb-5"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 350,
                        fontSize: 14,
                        lineHeight: 1.65,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      We look forward to your approval to proceed.
                    </Text>
                    <Text className="m-0 mb-1" style={{ fontSize: 14, color: RC_COLORS.textOnLight }}>
                      Kind regards,
                    </Text>
                    <Text
                      className="m-0"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontSize: 16,
                        color: RC_COLORS.gold,
                      }}
                    >
                      Gurpinder Uppal
                    </Text>
                    <Text
                      className="m-0"
                      style={{ fontSize: 13, color: RC_COLORS.textMutedOnLight }}
                    >
                      Royal Constructions Pty Ltd
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            <EmailFooter />
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
}
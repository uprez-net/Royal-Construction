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
import { EmailLeadContextSummary, LeadEmailContext } from './email-lead-context';

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────
// Updated stroke color to match RC_COLORS.gold (#C9A84C) and Navy (#1B2D45)

const ICONS = {
  star: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolygon points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'%3E%3C/polygon%3E%3C/svg%3E`,
  tree: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M17 8c.7-1 1-2.2 1-3.5C18 2.5 16.5 1 14.5 1c-1 0-1.8.4-2.5 1C11.3 1.4 10.5 1 9.5 1 7.5 1 6 2.5 6 4.5 6 5.8 6.3 7 7 8'%3E%3C/path%3E%3Cpath d='M12 2v20'%3E%3C/path%3E%3Cpath d='M7 8h10l-5 8-5-8z'%3E%3C/path%3E%3C/svg%3E`,
  clock: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
  clockDark: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%231B2D45' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function OfferCard({
  icon,
  title,
  badge,
  badgeVariant = 'outline',
  mobileClass = '',
}: {
  icon: string;
  title: string | React.ReactNode;
  badge: string;
  badgeVariant?: 'solid' | 'outline';
  mobileClass?: string;
}) {
  return (
    <Column
      className={`mobile_offer_stack ${mobileClass}`}
      style={{ width: '33.33%', verticalAlign: 'top' }}
    >
      <Section
        style={{
          backgroundColor: RC_COLORS.light,
          border: '1px solid #E2E8F0',
          borderRadius: 6,
          height: '100%',
        }}
      >
        <Row>
          <Column className="py-6 px-4 text-center">
            <Img
              alt=""
              height={32}
              src={icon}
              width={32}
              className="block outline-none border-none mx-auto mb-3.5"
            />
            <Text
              className="m-0 mb-2 text-[13px] leading-tight"
              style={{
                fontFamily: FONTS.condensed,
                fontWeight: 500,
                color: RC_COLORS.textOnLight,
              }}
            >
              {title}
            </Text>

            {badgeVariant === 'solid' ? (
              <Section className="mx-auto" style={{ display: 'inline-block' }}>
                <Row>
                  <Column style={{ backgroundColor: RC_COLORS.gold, borderRadius: 4 }}>
                    <Text
                      className="m-0 uppercase tracking-[0.5px]"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 11,
                        lineHeight: 1,
                        color: '#FFFFFF',
                        padding: '0.25rem 0.5rem',
                      }}
                    >
                      {badge}
                    </Text>
                  </Column>
                </Row>
              </Section>
            ) : (
              <Section className="mx-auto" style={{ display: 'inline-block' }}>
                <Row>
                  <Column
                    style={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: 4,
                    }}
                  >
                    <Text
                      className="m-0 uppercase tracking-[0.5px]"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 11,
                        lineHeight: 1,
                        color: RC_COLORS.gold,
                        padding: '0.25rem 0.5rem',
                      }}
                    >
                      {badge}
                    </Text>
                  </Column>
                </Row>
              </Section>
            )}
          </Column>
        </Row>
      </Section>
    </Column>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface SpecialOfferEmailProps {
  name?: string;
  savingsAmount?: string;
  claimUrl?: string;
  leadContext?: LeadEmailContext;
}

export default function SpecialOfferEmail({
  name = 'Homeowner',
  savingsAmount = '$8,500',
  claimUrl = RC_URLS.claimOffer,
  leadContext,
}: SpecialOfferEmailProps) {
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
            Exclusive upgrade package — confirm within 7 days to claim your offer
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <Container className="max-w-[640px] mx-auto" style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}>
            <EmailHeader showGoldBar />

            {/* ── Hero ── */}
            <EmailSectionLight style={{ padding: '2.5rem 1.5rem 0' }}>
              <Row>
                <Column className="text-center">
                  <Text
                    className="m-0 mb-5 uppercase"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 500,
                      fontSize: 11,
                      lineHeight: 1,
                      letterSpacing: '1.5px',
                      color: RC_COLORS.gold,
                    }}
                  >
                    Exclusive Offer
                  </Text>
                  <Text
                    className="mobile_font-40 m-0 mb-6 uppercase"
                    style={{
                      fontFamily: FONTS.condensed,
                      fontWeight: 500,
                      fontSize: 48,
                      lineHeight: 1,
                      letterSpacing: '-1.4px',
                      color: RC_COLORS.textOnLight,
                    }}
                  >
                    Your Dream Home,
                    <br />
                    Elevated
                  </Text>
                  <Text
                    className="mobile_max-w-full m-0 mx-auto"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 350,
                      fontSize: 14,
                      lineHeight: 1.7,
                      letterSpacing: '0.3px',
                      color: RC_COLORS.textMutedOnLight,
                      maxWidth: 440,
                    }}
                  >
                    Dear {name}, as a valued Royal Constructions client, we&apos;re thrilled to offer you an exclusive upgrade package — on us.
                  </Text>
                </Column>
              </Row>
            </EmailSectionLight>

            <EmailLeadContextSummary context={leadContext} />

            {/* ── Big Savings Callout ── */}
            <EmailSectionWhite style={{ padding: '2.5rem 1.5rem 3rem' }}>
              <Row>
                <Column className="text-center">
                  <Section
                    className="mx-auto"
                    style={{
                      backgroundColor: RC_COLORS.light,
                      border: `2px solid ${RC_COLORS.gold}`,
                      borderRadius: 6,
                      display: 'inline-block',
                    }}
                  >
                    <Row>
                      <Column className="py-8 px-12 text-center">
                        <Text
                          className="m-0 mb-3 uppercase"
                          style={{
                            fontFamily: FONTS.body,
                            fontWeight: 500,
                            fontSize: 11,
                            lineHeight: 1,
                            letterSpacing: '1px',
                            color: RC_COLORS.textMutedOnLight,
                          }}
                        >
                          You could save up to
                        </Text>
                        <Text
                          className="m-0"
                          style={{
                            fontFamily: FONTS.condensed,
                            fontWeight: 500,
                            fontSize: 56,
                            lineHeight: 1,
                            color: RC_COLORS.gold,
                            letterSpacing: '-1px',
                          }}
                        >
                          {savingsAmount}
                        </Text>
                      </Column>
                    </Row>
                  </Section>
                </Column>
              </Row>
            </EmailSectionWhite>

            {/* ── 3 Offer Cards ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 3rem' }}>
              <Row>
                <OfferCard
                  icon={ICONS.star}
                  title={
                    <>
                      FREE Premium
                      <br />
                      Kitchen Upgrade
                    </>
                  }
                  badge={`Value ${savingsAmount}`}
                  badgeVariant="solid"
                  mobileClass="mobile_offer_stack pr-2"
                />
                <OfferCard
                  icon={ICONS.tree}
                  title={
                    <>
                      Complimentary
                      <br />
                      Landscaping Consult
                    </>
                  }
                  badge="Free"
                  badgeVariant="outline"
                  mobileClass="mobile_offer_stack px-1"
                />
                <OfferCard
                  icon={ICONS.clock}
                  title={
                    <>
                      Priority
                      <br />
                      Scheduling
                    </>
                  }
                  badge="Fast-Track"
                  badgeVariant="outline"
                  mobileClass="mobile_offer_stack mobile_offer_last pl-2"
                />
              </Row>
            </EmailSectionLight>

            {/* ── Urgency Bar ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Row>
                <Column style={{ backgroundColor: RC_COLORS.gold, borderRadius: 6 }}>
                  <Section className="py-5 px-6">
                    <Row>
                      <Column className="text-center">
                        <Section className="mx-auto" style={{ display: 'inline-block' }}>
                          <Row>
                            <Column className="pr-3" style={{ verticalAlign: 'middle' }}>
                              <Img alt="" height={20} src={ICONS.clockDark} width={20} className="block outline-none border-none" />
                            </Column>
                            <Column style={{ verticalAlign: 'middle' }}>
                              <Text
                                className="m-0 uppercase tracking-[0.8px]"
                                style={{
                                  fontFamily: FONTS.condensed,
                                  fontWeight: 500,
                                  fontSize: 14,
                                  lineHeight: 1,
                                  color: '#1B2D45', // Navy text on gold for premium contrast
                                }}
                              >
                                Confirm within 7 days to unlock this offer
                              </Text>
                            </Column>
                          </Row>
                        </Section>
                      </Column>
                    </Row>
                  </Section>
                </Column>
              </Row>
            </EmailSectionWhite>

            {/* ── CTA ── */}
            <EmailSectionLight style={{ padding: '0.5rem 1.5rem 2.5rem' }}>
              <Section style={{ textAlign: 'center' }}>
                <Text
                  className="m-0 mb-7"
                  style={{
                    fontFamily: FONTS.body,
                    fontWeight: 350,
                    fontSize: 14,
                    lineHeight: 1.7,
                    letterSpacing: '0.3px',
                    color: RC_COLORS.textMutedOnLight,
                  }}
                >
                  Let&apos;s discuss how we can make your dream home even better.
                </Text>
                <EmailCtaButton href={claimUrl} label="Claim Your Offer" align="center" />
              </Section>
            </EmailSectionLight>

            {/* ── Terms ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 3rem' }}>
              <Row>
                <Column className="text-center">
                  <Text
                    className="m-0"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 350,
                      fontSize: 11,
                      lineHeight: 1.5,
                      letterSpacing: '0.3px',
                      color: RC_COLORS.dimmed, // Lighter slate for terms
                    }}
                  >
                    Offer valid for new confirmations only. Kitchen upgrade applies to selected ranges.{' '}
                    <Link
                      href={RC_URLS.terms}
                      target="_blank"
                      style={{ color: RC_COLORS.dimmed, textDecoration: 'underline' }}
                    >
                      Full terms &amp; conditions
                    </Link>
                    .
                  </Text>
                </Column>
              </Row>
            </EmailSectionWhite>

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
                      We look forward to building something extraordinary with you.
                    </Text>
                    <Text className="m-0 mb-1" style={{ fontSize: 14, color: RC_COLORS.textOnLight }}>
                      Warm regards,
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

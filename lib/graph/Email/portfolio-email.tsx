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
  RC_URLS_APP,
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

// ─── Credential Item Sub-Component ──────────────────────────────────────────

function CredentialItem({ text }: { text: string }) {
  return (
    <Row style={{ marginBottom: '0.625rem' }}>
      <Column style={{ width: 24, verticalAlign: 'top', paddingTop: '2px' }}>
        <Text
          className="m-0"
          style={{
            fontFamily: FONTS.body,
            fontSize: 16,
            lineHeight: 1,
            color: RC_COLORS.gold,
          }}
        >
          ✓
        </Text>
      </Column>
      <Column style={{ paddingLeft: 8 }}>
        <Text
          className="m-0"
          style={{
            fontFamily: FONTS.body,
            fontWeight: 350,
            fontSize: 14,
            lineHeight: 1.65,
            color: RC_COLORS.textMutedOnLight,
          }}
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
  leadContext?: LeadEmailContext;
}

export default function PortfolioEmail({
  name = 'Homeowner',
  leadContext,
}: PortfolioEmailProps) {
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
          {/* ── Preheader ── */}
          <div className="hidden overflow-hidden leading-none opacity-none max-h-0 max-w-0">
            Royal Constructions — Our Builder Profile, Licences, and Project
            Portfolio attached for your review.
            <div>
              &nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿
            </div>
          </div>

          <Container
            className="max-w-[640px] mx-auto"
            style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}
          >
            <EmailHeader showGoldBar />

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
                Builder Profile
              </Text>
              <Text
                className="m-0"
                style={{
                  fontFamily: FONTS.body,
                  fontWeight: 350,
                  fontSize: 14,
                  lineHeight: 1.7,
                  letterSpacing: '0.3px',
                  color: RC_COLORS.textMutedOnLight,
                  maxWidth: 490,
                }}
              >
                Dear {name}, here is the Royal Constructions builder profile and project portfolio for your review before we discuss the next step for your project.
              </Text>
            </EmailSectionLight>

            <EmailLeadContextSummary context={leadContext} />

            {/* ── Hero Image ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2rem' }}>
              <Img
                alt="Royal Constructions Portfolio"
                src={RC_URLS.heroPortfolio}
                width={592}
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: 592,
                  height: 'auto',
                  borderRadius: 4,
                }}
              />
            </EmailSectionWhite>

            {/* ── Credentials CTA Card ── */}
            <EmailSectionWhite style={{ padding: '2rem 1.5rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.light,
                  borderRadius: 6,
                  border: `2px solid ${RC_COLORS.gold}`,
                  padding: '1.5rem',
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="m-0 mb-3 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 13,
                        letterSpacing: '0.6px',
                        color: RC_COLORS.gold,
                      }}
                    >
                      What&apos;s inside
                    </Text>
                    <Text
                      className="m-0 mb-5 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 26,
                        lineHeight: 1.1,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      Our Builder Profile Includes
                    </Text>

                    <CredentialItem text="Our NSW Builder's Licence & Insurances" />
                    <CredentialItem text="Master Builders Association Accreditations" />
                    <CredentialItem text="A detailed list of our active and recently completed projects across Greater Sydney" />

                    <Text
                      className="m-0 mt-5 mb-5"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 350,
                        fontSize: 14,
                        lineHeight: 1.65,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      We manage every project from approval through to handover
                      with no outsourcing of responsibility, ensuring consistency
                      and quality on every job.
                    </Text>

                    <EmailCtaButton
                      href={RC_URLS_APP.builderProfile}
                      label="Download / View Builder Profile"
                      align="left"
                    />
                    <Text
                      className="m-0 mt-4"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 350,
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      If you have trouble accessing the document, reply to this
                      email and we will send it directly.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionWhite>

            {/* ── Reply Prompt Notice ── */}
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
                      Please feel free to review the attached document. If you
                      have any questions or are ready to discuss your project,
                      simply reply to this email.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* ── Sign-off ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2.5rem' }}>
              <Section
                style={{
                  borderTop: '1px solid #E2E8F0',
                  paddingTop: '1.5rem',
                }}
              >
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
                      We look forward to building something extraordinary with
                      you.
                    </Text>
                    <Text
                      className="m-0 mb-1"
                      style={{
                        fontSize: 14,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
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
                      style={{
                        fontSize: 13,
                        color: RC_COLORS.textMutedOnLight,
                      }}
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

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
  name = 'Homeowner',
  type = 'New Home Build',
  location = 'NSW',
  notes = 'Discussed initial design preferences, block orientation, and budget expectations for the project.',
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
          {/* Preheader */}
          <div className="hidden overflow-hidden leading-none opacity-none max-h-0 max-w-0">
            Following up on your project — let&apos;s take the next step
            together
            <div>
              &nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿
            </div>
          </div>

          <Container
            className="max-w-[640px] mx-auto"
            style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}
          >
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
                Follow-up
              </Text>
              <Text
                className="mobile_font-40 m-0 uppercase"
                style={{
                  fontFamily: FONTS.condensed,
                  fontWeight: 500,
                  fontSize: 48,
                  lineHeight: 1,
                  letterSpacing: '-1.2px',
                  color: RC_COLORS.textOnLight,
                }}
              >
                Let&apos;s Keep the
                <br />
                Momentum Going
              </Text>
              <Text
                className="m-0 mt-8"
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
                Dear {name}, I wanted to follow up on our recent conversation
                regarding your{' '}
                <span style={{ color: RC_COLORS.textOnLight, fontWeight: 450 }}>
                  {type}
                </span>{' '}
                project at{' '}
                <span style={{ color: RC_COLORS.textOnLight, fontWeight: 450 }}>
                  {location}
                </span>
                . It was great connecting with you and learning more about your
                vision.
              </Text>
            </EmailSectionLight>

            {/* ── Discussion Notes Card ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  borderRadius: 6,
                  border: '1px solid #E2E8F0',
                  padding: '1.5rem',
                }}
              >
                <Row
                  style={{
                    borderBottom: '1px solid #E2E8F0',
                    paddingBottom: '0.75rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  <Column
                    style={{ width: 24, verticalAlign: 'middle', paddingRight: 10 }}
                  >
                    <Img
                      alt=""
                      height={18}
                      src={ICONS.chat}
                      width={18}
                      style={{ display: 'block', outline: 'none', border: 'none' }}
                    />
                  </Column>
                  <Column style={{ verticalAlign: 'middle' }}>
                    <Text
                      className="m-0 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 13,
                        letterSpacing: '0.6px',
                        color: RC_COLORS.gold,
                      }}
                    >
                      What we discussed
                    </Text>
                  </Column>
                </Row>
                <Row>
                  <Column>
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
                      {notes}
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* ── Schedule Call CTA Card ── */}
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
                      Next step
                    </Text>
                    <Text
                      className="m-0 mb-4 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 26,
                        lineHeight: 1.1,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      Schedule a quick call
                    </Text>
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
                      I&apos;d love to answer any questions you might have and
                      help move things forward. Would you be available for a
                      quick call this week?
                    </Text>
                    <EmailCtaButton
                      href={scheduleCallUrl}
                      label="Schedule a Call"
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
                      If no suitable time is available, reply to this email and
                      we will help arrange one.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionWhite>

            {/* ── Encouragement Note ── */}
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
                      Building a home is a big decision — there&apos;s{' '}
                      <span style={{ color: RC_COLORS.gold, fontWeight: 450 }}>
                        no rush
                      </span>{' '}
                      and{' '}
                      <span style={{ color: RC_COLORS.gold, fontWeight: 450 }}>
                        no pressure
                      </span>
                      . We&apos;re here whenever you&apos;re ready to take the
                      next step.
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
                      className="m-0 mb-1"
                      style={{ fontSize: 14, color: RC_COLORS.textOnLight }}
                    >
                      Best regards,
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
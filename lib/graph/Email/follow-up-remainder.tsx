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
  calendar: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E`,
  clock: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
  pin: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'%3E%3C/path%3E%3Ccircle cx='12' cy='10' r='3'%3E%3C/circle%3E%3C/svg%3E`,
  user: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'%3E%3C/path%3E%3Ccircle cx='12' cy='7' r='4'%3E%3C/circle%3E%3C/svg%3E`,
  mail: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z'%3E%3C/path%3E%3Cpolyline points='22,6 12,13 2,6'%3E%3C/polyline%3E%3C/svg%3E`,
  phone: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'%3E%3C/path%3E%3C/svg%3E`,
};

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
    <Row
      style={{
        borderBottom: showBorder ? '1px solid #E2E8F0' : undefined,
      }}
    >
      <Column style={{ padding: '1rem 1.5rem' }}>
        <Row>
          <Column
            style={{ width: 36, verticalAlign: 'top', paddingTop: 2 }}
          >
            <Img
              alt=""
              height={20}
              src={icon}
              width={20}
              style={{
                display: 'block',
                outline: 'none',
                border: 'none',
              }}
            />
          </Column>
          <Column style={{ paddingLeft: 12 }}>
            <Text
              className="m-0 mb-1 uppercase"
              style={{
                fontFamily: FONTS.body,
                fontWeight: 300,
                fontSize: 11,
                lineHeight: 1.4,
                letterSpacing: '0.4px',
                color: RC_COLORS.textMutedOnLight,
              }}
            >
              {label}
            </Text>
            <Text
              className="m-0"
              style={{
                fontFamily: FONTS.condensed,
                fontWeight: 500,
                fontSize: 16,
                lineHeight: 1.2,
                color: RC_COLORS.textOnLight,
              }}
            >
              {value}
            </Text>
          </Column>
        </Row>
      </Column>
    </Row>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface FollowUpReminderEmailProps {
  assigneeName?: string;
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  leadLocation?: string;
  followupTime?: string;
  followupNotes?: string;
  crmUrl?: string;
}

export default function FollowUpReminderEmail({
  assigneeName = 'Team',
  leadName = 'Unknown Lead',
  leadPhone = 'Not provided',
  leadEmail = 'Not provided',
  leadLocation = 'Not provided',
  followupTime = 'Anytime today',
  followupNotes = '',
  crmUrl = 'https://royalconstructions.com.au/',
}: FollowUpReminderEmailProps) {
  return (
    <Tailwind config={TAILWIND_CONFIG}>
      <Html lang="en" dir="ltr">
        <Head>
          <meta
            content="text/html; charset=UTF-8"
            httpEquiv="Content-Type"
          />
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
            You have a scheduled lead follow-up task that requires your
            attention today.
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
                Daily Lead Reminder
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
                Follow-up
                <br />
                Required
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
                Hi {assigneeName} 👋, you have a scheduled follow-up task that
                requires your attention today. Taking quick action helps keep
                our leads warm and engaged. Please review the details below.
              </Text>
            </EmailSectionLight>

            {/* ── Lead Details Card ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  borderRadius: 6,
                  border: '1px solid #E2E8F0',
                  overflow: 'hidden',
                }}
              >
                {/* Card Header with gold bar */}
                <Row
                  style={{
                    backgroundColor: RC_COLORS.gold,
                  }}
                >
                  <Column
                    style={{
                      width: '70%',
                      verticalAlign: 'middle',
                      padding: '0.875rem 1.5rem',
                    }}
                  >
                    <Text
                      className="m-0 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 13,
                        lineHeight: 1,
                        letterSpacing: '0.6px',
                        color: RC_COLORS.white,
                      }}
                    >
                      Lead Details
                    </Text>
                  </Column>
                  <Column
                    style={{
                      width: '30%',
                      verticalAlign: 'middle',
                      padding: '0.875rem 1.5rem',
                      textAlign: 'right',
                    }}
                  >
                    <Section
                      style={{
                        backgroundColor: RC_COLORS.white,
                        borderRadius: 50,
                        display: 'inline-block',
                      }}
                    >
                      <Row>
                        <Column style={{ padding: '4px 12px' }}>
                          <Text
                            className="m-0 uppercase"
                            style={{
                              fontFamily: FONTS.body,
                              fontWeight: 700,
                              fontSize: 10,
                              letterSpacing: '0.5px',
                              color: RC_COLORS.gold,
                            }}
                          >
                            Action Required
                          </Text>
                        </Column>
                      </Row>
                    </Section>
                  </Column>
                </Row>

                {/* Card Rows */}
                <DetailRow
                  icon={ICONS.user}
                  label="Client"
                  value={leadName}
                  showBorder
                />
                <DetailRow
                  icon={ICONS.phone}
                  label="Phone"
                  value={leadPhone}
                  showBorder
                />
                <DetailRow
                  icon={ICONS.mail}
                  label="Email"
                  value={leadEmail}
                  showBorder
                />
                <DetailRow
                  icon={ICONS.pin}
                  label="Location"
                  value={leadLocation}
                  showBorder
                />
                <DetailRow
                  icon={ICONS.clock}
                  label="Follow-up Time"
                  value={followupTime}
                  showBorder={false}
                />
              </Section>
            </EmailSectionLight>

            {/* ── Context & Notes Block ── */}
            {followupNotes && (
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
                        className="m-0 mb-2 uppercase"
                        style={{
                          fontFamily: FONTS.body,
                          fontWeight: 700,
                          fontSize: 10,
                          letterSpacing: '0.5px',
                          color: RC_COLORS.textMutedOnLight,
                        }}
                      >
                        💬 Context &amp; Notes
                      </Text>
                      <Text
                        className="m-0"
                        style={{
                          fontFamily: FONTS.body,
                          fontWeight: 350,
                          fontSize: 13,
                          lineHeight: 1.65,
                          fontStyle: 'italic',
                          color: RC_COLORS.textMutedOnLight,
                        }}
                      >
                        &ldquo;{followupNotes}&rdquo;
                      </Text>
                    </Column>
                  </Row>
                </Section>
              </EmailSectionLight>
            )}

            {/* ── Open CRM CTA Card ── */}
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
                      Take action
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
                      Open the lead in CRM
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
                      Use the link below to access the lead record, review the
                      full history, and log your follow-up outcome.
                    </Text>
                    <EmailCtaButton
                      href={crmUrl}
                      label="Open Lead in CRM"
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
                      If you are unable to reach the client today, update the
                      CRM with the outcome and schedule a new follow-up time.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionWhite>

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
                      style={{
                        fontSize: 14,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
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
                      Royal Constructions CRM
                    </Text>
                    <Text
                      className="m-0"
                      style={{
                        fontSize: 13,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      Automated Notification System
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
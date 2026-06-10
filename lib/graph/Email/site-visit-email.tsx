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
// Updated stroke color to match RC_COLORS.gold (#C9A84C)

const ICONS = {
  calendar: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E`,
  clock: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'%3E%3C/circle%3E%3Cpolyline points='12 6 12 12 16 14'%3E%3C/polyline%3E%3C/svg%3E`,
  pin: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z'%3E%3C/path%3E%3Ccircle cx='12' cy='10' r='3'%3E%3C/circle%3E%3C/svg%3E`,
  check: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E`,
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
    <Row style={{ borderBottom: showBorder ? '1px solid #E2E8F0' : undefined }}>
      <Column className="py-5 px-6">
        <Row>
          <Column className="pt-[2px]" style={{ width: 36, verticalAlign: 'top' }}>
            <Img alt="" height={20} src={icon} width={20} className="block outline-none border-none" />
          </Column>
          <Column className="pl-3">
            <Text
              className="m-0 mb-1 uppercase"
              style={{
                fontFamily: FONTS.body,
                fontWeight: 500,
                fontSize: 10,
                letterSpacing: '0.8px',
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
    <Section
      style={{
        padding: '1.25rem 0',
        borderBottom: showBorder ? '1px solid #E2E8F0' : undefined,
      }}
    >
      <Row>
        <Column className="pt-[2px]" style={{ width: 36, verticalAlign: 'top' }}>
          <Img alt="" height={18} src={ICONS.check} width={18} className="block outline-none border-none" />
        </Column>
        <Column className="pl-3">
          <Text
            className="m-0"
            style={{
              fontFamily: FONTS.condensed,
              fontWeight: 500,
              fontSize: 15,
              lineHeight: 1.3,
              color: RC_COLORS.textOnLight,
            }}
          >
            {title}
          </Text>
          <Text
            className="m-0 mt-1.5"
            style={{
              fontFamily: FONTS.body,
              fontWeight: 350,
              fontSize: 13,
              lineHeight: 1.5,
              letterSpacing: '0.2px',
              color: RC_COLORS.textMutedOnLight,
            }}
          >
            {description}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface SiteVisitEmailProps {
  name?: string;
  date?: string;
  time?: string;
  location?: string;
  calendarUrl?: string;
  leadContext?: LeadEmailContext;
}

export default function SiteVisitEmail({
  name = 'Client',
  date = 'TBD',
  time = 'TBD',
  location = 'TBD',
  calendarUrl = RC_URLS.bookConsultation,
  leadContext,
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
            Your site visit is confirmed — review the details and what to expect
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
                Meeting Confirmation
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
                Site Visit
                <br />
                Confirmed
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
                      maxWidth: 490,
                    }}
                  >
                    This confirms your site visit has been scheduled. Please review the details below and ensure the site is accessible at the designated time.
                  </Text>
                </Column>
              </Row>
            </EmailSectionLight>

            <EmailLeadContextSummary context={leadContext} />

            {/* ── Event Details Card ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Row>
                <Column
                  className="rounded-md overflow-hidden"
                  style={{ border: '1px solid #E2E8F0' }}
                >
                  {/* Card Header */}
                  <Row>
                    <Column className="py-3.5 px-6" style={{ backgroundColor: RC_COLORS.gold }}>
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
                        Appointment Details
                      </Text>
                    </Column>
                  </Row>

                  <DetailRow icon={ICONS.calendar} label="Date" value={date} showBorder />
                  <DetailRow icon={ICONS.clock} label="Time" value={time} showBorder />
                  <DetailRow icon={ICONS.pin} label="Location" value={location} showBorder={false} />
                </Column>
              </Row>
            </EmailSectionWhite>

            {/* ── What to Expect ── */}
            <EmailSectionLight style={{ padding: '2rem 1.5rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  borderRadius: 6,
                  border: '1px solid #E2E8F0',
                  padding: '1.5rem',
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="mobile_font-24 m-0 mb-6 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 26,
                        lineHeight: 1,
                        letterSpacing: '0.3px',
                        color: RC_COLORS.textOnLight,
                      }}
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
            </EmailSectionLight>

            {/* ── Add to Calendar CTA ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Section style={{ textAlign: 'center' }}>
                <EmailCtaButton href={calendarUrl} label="Add to Calendar" align="center" />
              </Section>
            </EmailSectionWhite>

            {/* ── Important Notice ── */}
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
                      Please ensure{' '}
                      <span style={{ fontWeight: 600, color: RC_COLORS.textOnLight }}>
                        someone is available at the site
                      </span>{' '}
                      during the scheduled time so our team can conduct a thorough assessment.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* ── Need to Reschedule ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2rem' }}>
              <Row>
                <Column>
                  <Text
                    className="m-0 mb-1"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 500,
                      fontSize: 15,
                      lineHeight: 1.5,
                      color: RC_COLORS.textOnLight,
                    }}
                  >
                    Need to reschedule?
                  </Text>
                  <Text
                    className="mobile_max-w-full m-0"
                    style={{
                      fontFamily: FONTS.body,
                      fontWeight: 350,
                      fontSize: 13,
                      lineHeight: 1.65,
                      letterSpacing: '0.2px',
                      color: RC_COLORS.textMutedOnLight,
                      maxWidth: 490,
                    }}
                  >
                    No worries — simply reply to this email or call us at{' '}
                    <Link href="tel:1300832355" style={{ color: RC_COLORS.gold, textDecoration: 'none' }}>
                      1300 832 355
                    </Link>{' '}
                    and we&apos;ll find a time that works.
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
                      We look forward to seeing you on-site.
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

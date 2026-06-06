import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Text,
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
import { EmailSectionLight } from './email-section-light';

// ─── Icons (Using Emojis instead of Data URIs) ──────────────────────────────

const ICONS = {
  calendar: '📅',
  clock: '🕒',
  pin: '📍',
};

// ─── Sub-Component ──────────────────────────────────────────────────────────

function DetailItem({
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
      <Column style={{ padding: '1rem 0' }}>
        <Row>
          <Column style={{ width: 36, verticalAlign: 'top', paddingTop: 2 }}>
            {/* Replaced <Img> with <Text> for the emoji */}
            <Text
              className="m-0"
              style={{
                fontSize: 22,
                lineHeight: 1,
              }}
            >
              {icon}
            </Text>
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
                fontSize: 17,
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

interface FollowUpStageMeetingProps {
  name?: string;
  formattedDate?: string;
  formattedTime?: string;
  location?: string;
}

export default function FollowUpStageMeeting({
  name = 'Homeowner',
  formattedDate = 'Saturday 6 June 2026',
  formattedTime = '09:00 am - 10:00 am (AEST)',
  location = 'Microsoft Teams Meeting',
}: FollowUpStageMeetingProps) {
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
                Appointment Confirmation
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
                Follow-Up Meeting
                <br />
                Confirmed
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
                Dear {name},
                <br />
                <br />
                Your consultation has been scheduled. Please review the details
                below, and ensure you are available at the specified time.
              </Text>
            </EmailSectionLight>

            {/* ── Details Card ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 2rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  borderRadius: 6,
                  border: '1px solid #E2E8F0',
                  padding: '0.5rem 1.5rem',
                }}
              >
                <DetailItem
                  icon={ICONS.calendar}
                  label="Date"
                  value={formattedDate}
                  showBorder
                />
                <DetailItem
                  icon={ICONS.clock}
                  label="Time"
                  value={formattedTime}
                  showBorder
                />
                <DetailItem
                  icon={ICONS.pin}
                  label="Location"
                  value={location}
                  showBorder={false}
                />
              </Section>
            </EmailSectionLight>

            {/* ── Teams Notice ── */}
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
                      A Microsoft Teams meeting link will be included in the
                      calendar invite. Please click the link at the scheduled
                      time to join the consultation.
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
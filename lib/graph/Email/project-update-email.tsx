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
import { EmailSectionLight } from './email-section-light';
import { EmailSectionWhite } from './email-section-white';

// ─── Icons (Data URIs) ─────────────────────────────────────────────────────
// Updated stroke colors for Light Theme compatibility

const ICONS = {
  checkNavySmall: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%231B2D45' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E`,
  checkWhiteSmall: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23FFFFFF' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E`,
  calendar: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E`,
  camera: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='none' stroke='%23C9A84C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'%3E%3C/path%3E%3Ccircle cx='12' cy='13' r='4'%3E%3C/circle%3E%3C/svg%3E`,
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function ProgressStep({
  label,
  state,
}: {
  label: string;
  state: 'completed' | 'current' | 'upcoming';
}) {
  const isCompleted = state === 'completed';
  const isCurrent = state === 'current';

  return (
    <Column
      style={{ width: '25%', verticalAlign: 'top', textAlign: 'center' }}
    >
      <Section className="mx-auto" style={{ display: 'inline-block' }}>
        <Row>
          <Column
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              textAlign: 'center',
              verticalAlign: 'middle',
              backgroundColor: isCompleted ? RC_COLORS.gold : RC_COLORS.white,
              border: isCompleted
                ? 'none'
                : `2px solid ${isCurrent ? RC_COLORS.gold : '#E2E8F0'}`,
            }}
          >
            {isCompleted ? (
              <Img
                alt=""
                height={12}
                src={ICONS.checkWhiteSmall}
                width={12}
                className="block outline-none border-none mx-auto"
              />
            ) : (
              <Section className="mx-auto" style={{ display: 'inline-block' }}>
                <Row>
                  <Column
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: isCurrent ? RC_COLORS.gold : '#CBD5E1',
                      fontSize: 0,
                      lineHeight: 0,
                    }}
                  />
                </Row>
              </Section>
            )}
          </Column>
        </Row>
      </Section>
      <Text
        className="m-0 mt-2 uppercase text-[11px] leading-tight"
        style={{
          fontFamily: FONTS.condensed,
          fontWeight: 500,
          color: isCompleted
            ? RC_COLORS.gold
            : isCurrent
            ? RC_COLORS.textOnLight
            : RC_COLORS.dimmed,
        }}
      >
        {label}
      </Text>
    </Column>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

const DEFAULT_STEPS = [
  { label: 'Foundation', state: 'completed' as const },
  { label: 'Frame', state: 'completed' as const },
  { label: 'Lock-Up', state: 'current' as const },
  { label: 'Handover', state: 'upcoming' as const },
];

interface ProjectUpdateEmailProps {
  name?: string;
  location?: string;
  milestone?: string;
  date?: string;
  progressPercent?: number;
  steps?: { label: string; state: 'completed' | 'current' | 'upcoming' }[];
  nextMilestone?: string;
  portalUrl?: string;
}

export default function ProjectUpdateEmail({
  name = 'Client',
  location = 'Your Location',
  milestone = 'Lock-Up Stage',
  date = 'Today',
  progressPercent = 60,
  steps = DEFAULT_STEPS,
  nextMilestone = 'Practical Completion',
  portalUrl = RC_URLS.contact,
}: ProjectUpdateEmailProps) {
  const filledWidth = `${Math.min(Math.max(progressPercent, 0), 100)}%`;
  const emptyWidth = `${100 - Math.min(Math.max(progressPercent, 0), 100)}%`;

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
            Great news — your project has reached an important milestone
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <Container className="max-w-[640px] mx-auto" style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}>
            <EmailHeader showGoldBar />

            {/* ── Celebration Banner ── */}
            <Section style={{ backgroundColor: RC_COLORS.gold }}>
              <Row>
                <Column className="py-2.5 px-6">
                  <Section className="mx-auto" style={{ display: 'inline-block' }}>
                    <Row>
                      <Column className="pr-2" style={{ verticalAlign: 'middle' }}>
                        <Img alt="" height={16} src={ICONS.checkNavySmall} width={16} className="block outline-none border-none" />
                      </Column>
                      <Column style={{ verticalAlign: 'middle' }}>
                        <Text
                          className="m-0 uppercase tracking-[1px]"
                          style={{
                            fontFamily: FONTS.condensed,
                            fontWeight: 500,
                            fontSize: 12,
                            lineHeight: 1,
                            color: RC_COLORS.textOnLight,
                          }}
                        >
                          Milestone Achieved
                        </Text>
                      </Column>
                    </Row>
                  </Section>
                </Column>
              </Row>
            </Section>

            {/* ── Hero ── */}
            <EmailSectionLight style={{ padding: '2.5rem 1.5rem 1.5rem' }}>
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
                Project Update
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
                Another Step
                <br />
                Complete
              </Text>
            </EmailSectionLight>

            {/* ── Intro ── */}
            <EmailSectionLight style={{ padding: '0.5rem 1.5rem 2.5rem' }}>
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
                    Great news! Your project at{' '}
                    <span style={{ fontWeight: 600, color: RC_COLORS.textOnLight }}>
                      {location}
                    </span>{' '}
                    has reached an important milestone. Here&apos;s a summary of the progress.
                  </Text>
                </Column>
              </Row>
            </EmailSectionLight>

            {/* ── Milestone Card ── */}
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
                          Milestone Completed
                        </Text>
                      </Section>
                    </Column>
                  </Row>

                  {/* Milestone Name */}
                  <Row style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <Column className="pt-7 pb-5 px-6">
                      <Row>
                        <Column className="pt-1" style={{ width: 40, verticalAlign: 'top' }}>
                          <Section style={{ width: 28, height: 28, backgroundColor: RC_COLORS.gold, borderRadius: '50%' }}>
                            <Row>
                              <Column style={{ textAlign: 'center', verticalAlign: 'middle', height: 28 }}>
                                <Img alt="" height={14} src={ICONS.checkWhiteSmall} width={14} className="block outline-none border-none mx-auto" />
                              </Column>
                            </Row>
                          </Section>
                        </Column>
                        <Column className="pl-3">
                          <Text
                            className="m-0 mb-1.5 uppercase"
                            style={{
                              fontFamily: FONTS.body,
                              fontWeight: 500,
                              fontSize: 10,
                              letterSpacing: '0.8px',
                              color: RC_COLORS.textMutedOnLight,
                            }}
                          >
                            Milestone
                          </Text>
                          <Text
                            className="m-0"
                            style={{
                              fontFamily: FONTS.condensed,
                              fontWeight: 500,
                              fontSize: 22,
                              lineHeight: 1.2,
                              color: RC_COLORS.textOnLight,
                            }}
                          >
                            {milestone}
                          </Text>
                        </Column>
                      </Row>
                    </Column>
                  </Row>

                  {/* Completion Date */}
                  <Row>
                    <Column className="py-5 px-6">
                      <Row>
                        <Column className="pt-[2px]" style={{ width: 40, verticalAlign: 'top' }}>
                          <Img alt="" height={20} src={ICONS.calendar} width={20} className="block outline-none border-none" />
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
                            Completion Date
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
                            {date}
                          </Text>
                        </Column>
                      </Row>
                    </Column>
                  </Row>
                </Column>
              </Row>
            </EmailSectionWhite>

            {/* ── Progress Indicator ── */}
            <EmailSectionLight style={{ padding: '0 1.5rem 3rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  border: '1px solid #E2E8F0',
                  borderRadius: 6,
                  padding: '1.5rem',
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="mobile_font-24 m-0 mb-7 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 26,
                        lineHeight: 1,
                        letterSpacing: '0.3px',
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      Project Progress
                    </Text>

                    {/* Progress Bar */}
                    <Section
                      className="mb-8"
                      style={{
                        backgroundColor: '#E2E8F0',
                        borderRadius: 100,
                        height: 6,
                        fontSize: 0,
                        lineHeight: 0,
                      }}
                    >
                      <Row>
                        <Column
                          style={{
                            backgroundColor: RC_COLORS.gold,
                            borderRadius: 100,
                            height: 6,
                            width: filledWidth,
                            fontSize: 0,
                            lineHeight: 0,
                          }}
                        />
                        <Column style={{ width: emptyWidth, fontSize: 0, lineHeight: 0 }} />
                      </Row>
                    </Section>

                    {/* Progress Steps */}
                    <Row>
                      {steps.map((step) => (
                        <ProgressStep key={step.label} label={step.label} state={step.state} />
                      ))}
                    </Row>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* ── Photo Updates Card ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Row>
                <Column
                  style={{
                    backgroundColor: RC_COLORS.light,
                    borderRadius: 6,
                    border: '1px solid #E2E8F0',
                  }}
                >
                  <Section className="p-6">
                    <Row>
                      <Column className="pr-4" style={{ width: 36, verticalAlign: 'top' }}>
                        <Img alt="" height={28} src={ICONS.camera} width={28} className="block outline-none border-none" />
                      </Column>
                      <Column style={{ verticalAlign: 'top' }}>
                        <Text
                          className="m-0 mb-1.5"
                          style={{
                            fontFamily: FONTS.condensed,
                            fontWeight: 500,
                            fontSize: 15,
                            lineHeight: 1.2,
                            color: RC_COLORS.textOnLight,
                          }}
                        >
                          Photo Updates Available
                        </Text>
                        <Text
                          className="m-0 mb-4"
                          style={{
                            fontFamily: FONTS.body,
                            fontWeight: 350,
                            fontSize: 13,
                            lineHeight: 1.5,
                            letterSpacing: '0.2px',
                            color: RC_COLORS.textMutedOnLight,
                          }}
                        >
                          See the latest progress photos from your site on the client portal.
                        </Text>
                        <Link
                          href={portalUrl}
                          target="_blank"
                          style={{
                            fontFamily: FONTS.body,
                            fontWeight: 600,
                            fontSize: 14,
                            lineHeight: 1.5,
                            color: RC_COLORS.gold,
                            textDecoration: 'none',
                          }}
                        >
                          View Photos&nbsp;→
                        </Link>
                      </Column>
                    </Row>
                  </Section>
                </Column>
              </Row>
            </EmailSectionWhite>

            {/* ── Next Milestone Notice ── */}
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
                      className="m-0 mb-1.5 uppercase"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 500,
                        fontSize: 11,
                        letterSpacing: '0.6px',
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      Coming up next
                    </Text>
                    <Text
                      className="m-0"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 400,
                        fontSize: 14,
                        lineHeight: 1.65,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      The next milestone is{' '}
                      <span style={{ fontWeight: 600, color: RC_COLORS.textOnLight }}>
                        {nextMilestone}
                      </span>
                      . We&apos;ll keep you updated as your project progresses.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* ── Sign-off ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
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
                      We look forward to seeing the project continue to take shape.
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
            </EmailSectionWhite>

            <EmailFooter />
          </Container>
        </Body>
      </Html>
    </Tailwind>
  );
}
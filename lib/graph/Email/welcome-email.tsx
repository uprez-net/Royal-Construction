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

const PROJECT_BRIEF_ITEMS = [
  {
    title: 'Land information',
    description:
      'Let us know whether you already own the land, are reviewing a block, or are still searching.',
  },
  {
    title: 'Project priorities',
    description:
      'Share what matters most to you, such as layout, finishes, number of rooms, outdoor space, or energy efficiency.',
  },
  {
    title: 'Build type',
    description:
      'Tell us if this is a new home, duplex, knockdown rebuild, extension, renovation, or another build type.',
  },
  {
    title: 'Location or address',
    description: 'Provide the suburb, lot details, or full site address if you already have it.',
  },
  {
    title: 'Timeline',
    description:
      'Share when you would like to start design, approvals, construction, or move in.',
  },
  {
    title: 'Existing documents and ideas',
    description:
      'Send any plans, surveys, council notes, inspiration images, sketches, or design ideas you already have.',
  },
];

function Step({
  number,
  title,
  description,
  showBorder = true,
}: {
  number: string;
  title: string;
  description: string;
  showBorder?: boolean;
}) {
  return (
    <Section
      style={{
        padding: '1.5rem 0',
        borderBottom: showBorder ? '1px solid #E2E8F0' : undefined,
      }}
    >
      <Row>
        <Column style={{ width: 44, verticalAlign: 'top' }}>
          <Text
            className="m-0"
            style={{
              fontFamily: FONTS.condensed,
              fontWeight: 500,
              fontSize: 22,
              lineHeight: 1,
              color: RC_COLORS.gold,
            }}
          >
            {number}
          </Text>
        </Column>
        <Column style={{ paddingLeft: 12 }}>
          <Text
            className="m-0 mb-2"
            style={{
              fontFamily: FONTS.condensed,
              fontWeight: 500,
              fontSize: 17,
              lineHeight: 1.2,
              color: RC_COLORS.textOnLight,
            }}
          >
            {title}
          </Text>
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
            {description}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

function GetStartedCard({
  title,
  description,
  linkLabel,
  linkHref,
  showBorder = true,
}: {
  title: string;
  description: string;
  linkLabel: string;
  linkHref: string;
  showBorder?: boolean;
}) {
  return (
    <Section
      style={{
        padding: '1.5rem 0',
        borderBottom: showBorder ? '1px solid #E2E8F0' : undefined,
      }}
    >
      <Row>
        <Column>
          <Text
            className="m-0 mb-3"
            style={{
              fontFamily: FONTS.condensed,
              fontWeight: 500,
              fontSize: 20,
              color: RC_COLORS.textOnLight,
            }}
          >
            {title}
          </Text>
          <Text
            className="m-0 mb-3"
            style={{
              fontFamily: FONTS.body,
              fontWeight: 350,
              fontSize: 14,
              lineHeight: 1.65,
              color: RC_COLORS.textMutedOnLight,
            }}
          >
            {description}
          </Text>
          <Link
            href={linkHref}
            target="_blank"
            style={{
              fontFamily: FONTS.body,
              fontWeight: 450,
              fontSize: 15,
              color: RC_COLORS.gold,
              textDecoration: 'none',
            }}
          >
            {linkLabel}&nbsp;→
          </Link>
        </Column>
      </Row>
    </Section>
  );
}

function AppointmentBookingCard({ bookingUrl }: { bookingUrl: string }) {
  return (
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
              First action
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
              Book your appointment with the builder
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
              Please use the link below to add a consultation to the builder calendar. This gives
              the team a fixed time to review your project and answer your questions.
            </Text>
            <EmailCtaButton href={bookingUrl} label="Book Appointment" align="left" />
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
              If no suitable time is available, reply to this email and we will help arrange one.
            </Text>
          </Column>
        </Row>
      </Section>
    </EmailSectionWhite>
  );
}

interface WelcomeEmailProps {
  name?: string;
  bookingUrl?: string;
}

export default function WelcomeEmail({
  name = 'Homeowner',
  bookingUrl = RC_URLS.bookConsultation,
}: WelcomeEmailProps) {
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
            Thanks for your interest in Royal Constructions — send your project details and book a
            builder calendar slot.
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <Container
            className="max-w-[640px] mx-auto"
            style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}
          >
            <EmailHeader showGoldBar />

            {/* Hero — original welcome copy */}
            <EmailSectionLight style={{ padding: '2.5rem 1.5rem 2rem' }}>
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
                Welcome to
                <br />
                Royal Constructions
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
                Dear {name}, thank you for your interest in building with Royal Constructions. The
                next step is to book an appointment with the builder, then reply with any project
                ideas you already have so we can prepare before your consultation.
              </Text>
            </EmailSectionLight>

            {/* Hero image */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2rem' }}>
              <Img
                alt="Luxury home by Royal Constructions"
                src={RC_URLS.heroDefault}
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

            <AppointmentBookingCard bookingUrl={bookingUrl} />

            {/* Before your appointment — original 6-item brief */}
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
                      className="m-0 mb-4 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 26,
                        lineHeight: 1,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      Before your appointment
                    </Text>
                    <Text
                      className="m-0 mb-4"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 350,
                        fontSize: 14,
                        lineHeight: 1.65,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      Please reply with whatever details you already have so we can prepare for the
                      consultation. It is okay if some items are still undecided.
                    </Text>
                    {PROJECT_BRIEF_ITEMS.map((item) => (
                      <Text
                        key={item.title}
                        className="m-0 mb-3"
                        style={{
                          fontFamily: FONTS.body,
                          fontSize: 14,
                          lineHeight: 1.55,
                          color: RC_COLORS.textMutedOnLight,
                        }}
                      >
                        <span style={{ color: RC_COLORS.gold, fontWeight: 500 }}>{item.title}:</span>{' '}
                        {item.description}
                      </Text>
                    ))}
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* What happens next — original 3 steps */}
            <EmailSectionWhite style={{ padding: '2.5rem 1.5rem 1rem' }}>
              <Text
                className="m-0 mb-6 uppercase"
                style={{
                  fontFamily: FONTS.condensed,
                  fontWeight: 500,
                  fontSize: 28,
                  lineHeight: 1,
                  color: RC_COLORS.textOnLight,
                }}
              >
                What happens next
              </Text>
              <Step
                number="01"
                title="Share Your Project Details"
                description="Reply with whatever details you already have so the builder can review them before the appointment."
              />
              <Step
                number="02"
                title="Meet With the Builder"
                description="Use the consultation to discuss your goals, site details, priorities, and preferred timeline."
              />
              <Step
                number="03"
                title="Review the Next Steps"
                description="Our team will review your information, clarify anything missing, and guide you through design, quotation, and approval next steps."
                showBorder={false}
              />
            </EmailSectionWhite>

            {/* Booking context notice */}
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
                      The booking button above is the appointment action. These next steps show how
                      we prepare once your time is reserved.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* Get started */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Text
                className="m-0 mb-4 uppercase"
                style={{
                  fontFamily: FONTS.condensed,
                  fontWeight: 500,
                  fontSize: 28,
                  lineHeight: 1,
                  color: RC_COLORS.textOnLight,
                }}
              >
                Get started
              </Text>
              <GetStartedCard
                title="Explore Our Portfolio"
                description="Browse completed projects across NSW for inspiration and ideas for your new home."
                linkLabel="View Projects"
                linkHref={RC_URLS.projects}
              />
              <GetStartedCard
                title="Contact the Team"
                description="Have a question before your appointment? Reply to this email or contact our office."
                linkLabel="Email Us"
                linkHref={`mailto:${RC_URLS.email}`}
                showBorder={false}
              />
            </EmailSectionWhite>

            {/* Sign-off */}
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
                    <Text
                      className="m-0 mb-1"
                      style={{ fontSize: 14, color: RC_COLORS.textOnLight }}
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

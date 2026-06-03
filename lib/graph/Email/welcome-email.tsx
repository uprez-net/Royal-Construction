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

const CUSTOM_HOME_BENEFITS = [
  'Design a home around your lifestyle',
  'Build on your land, your way',
  'Create a layout that truly works for you',
  'Choose finishes that reflect your style',
  'Build a home that suits your future plans',
];

const BUILD_PROCESS_STEPS = [
  {
    number: '01',
    title: 'Complimentary Consultation & Site Assessment',
    description:
      'We review your block, discuss your goals, and explore what’s possible based on your land and budget.',
  },
  {
    number: '02',
    title: 'Budget Planning',
    description:
      'We provide clear guidance on costs, allowances, and options so you can make informed decisions early.',
  },
  {
    number: '03',
    title: 'Custom Design',
    description:
      'Your home is thoughtfully designed to maximise space, light, and flow — tailored to how you live.',
  },
  {
    number: '04',
    title: 'Approvals & Preparations',
    description:
      'We manage council approvals and required documentation to keep things moving smoothly.',
  },
  {
    number: '05',
    title: 'Construction & Quality',
    description:
      'Our hands-on team oversees construction from start to finish, working with trusted trades and suppliers.',
  },
  {
    number: '06',
    title: 'Inspection & Handover',
    description:
      'Before handover, we complete final inspections to ensure everything meets our quality standards.',
  },
];

const APPOINTMENT_PREP_ITEMS = [
  { title: 'Land or location', description: 'Suburb, block details, or address if you have it.' },
  { title: 'Build type & priorities', description: 'New home, duplex, KDR, rooms, finishes, outdoor space.' },
  { title: 'Timeline', description: 'When you hope to start design, approvals, or construction.' },
  { title: 'Plans & ideas', description: 'Any sketches, inspiration images, surveys, or council notes.' },
];

function ProcessStep({
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
        borderBottom: showBorder ? `1px solid #E2E8F0` : undefined,
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
            className="m-0 mb-2 uppercase"
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
            Book your free site assessment with Royal Constructions — custom homes across NSW.
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <Container
            className="max-w-[640px] mx-auto"
            style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}
          >
            <EmailHeader showGoldBar />

            {/* Cream — hero copy (matches site hero on light background) */}
            <EmailSectionLight style={{ padding: '2rem 1.5rem 1.5rem' }}>
              <Text
                className="m-0 mb-3 uppercase"
                style={{
                  fontFamily: FONTS.body,
                  fontWeight: 500,
                  fontSize: 11,
                  letterSpacing: '1.2px',
                  color: RC_COLORS.gold,
                }}
              >
                Welcome, {name}
              </Text>
              <Text
                className="mobile_font-40 m-0 uppercase"
                style={{
                  fontFamily: FONTS.condensed,
                  fontWeight: 500,
                  fontSize: 42,
                  lineHeight: 1.05,
                  letterSpacing: '-0.8px',
                  color: RC_COLORS.textOnLight,
                }}
              >
                Custom Homes
              </Text>
              <Text
                className="m-0 mt-4"
                style={{
                  fontFamily: FONTS.body,
                  fontWeight: 350,
                  fontSize: 15,
                  lineHeight: 1.7,
                  color: RC_COLORS.textMutedOnLight,
                  maxWidth: 480,
                }}
              >
                Design and build a home that reflects your lifestyle, your land, and the way you
                want to live.
              </Text>
              <EmailCtaButton href={bookingUrl} label="Book Free Site Assessment" />
              <Text className="m-0 mt-4" style={{ fontSize: 13, lineHeight: 1.6 }}>
                <Link
                  href={RC_URLS.projects}
                  target="_blank"
                  style={{
                    fontFamily: FONTS.body,
                    fontWeight: 450,
                    color: RC_COLORS.gold,
                    textDecoration: 'none',
                  }}
                >
                  Explore our work&nbsp;→
                </Link>
              </Text>
            </EmailSectionLight>

            {/* White — hero image */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2rem' }}>
              <Img
                alt="Royal Constructions custom home build"
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

            {/* Cream — benefits */}
            <EmailSectionLight>
              <Text
                className="m-0 mb-4 uppercase"
                style={{
                  fontFamily: FONTS.condensed,
                  fontWeight: 500,
                  fontSize: 28,
                  lineHeight: 1.1,
                  color: RC_COLORS.textOnLight,
                  letterSpacing: '0.2px',
                }}
              >
                Build a Home That&apos;s Truly Yours
              </Text>
              <Text
                className="m-0 mb-5"
                style={{
                  fontFamily: FONTS.body,
                  fontWeight: 350,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: RC_COLORS.textMutedOnLight,
                }}
              >
                With Royal Constructions, your home isn&apos;t adapted from a standard design.
                It&apos;s carefully considered from the ground up — with clear communication and
                honest advice from design through to handover.
              </Text>
              {CUSTOM_HOME_BENEFITS.map((benefit) => (
                <Text
                  key={benefit}
                  className="m-0 mb-2.5"
                  style={{
                    fontFamily: FONTS.body,
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: RC_COLORS.textOnLight,
                  }}
                >
                  <span style={{ color: RC_COLORS.gold, fontWeight: 600 }}>✓&nbsp;</span>
                  {benefit}
                </Text>
              ))}
              <EmailCtaButton href={RC_URLS.customHomes} label="Build With Us" align="left" />
            </EmailSectionLight>

            {/* White — before consultation */}
            <EmailSectionWhite>
              <Section
                style={{
                  backgroundColor: RC_COLORS.light,
                  borderRadius: 6,
                  border: '1px solid #E2E8F0',
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
                        fontSize: 22,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      Before your consultation
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
                      Reply with whatever you already know — it&apos;s fine if some details are
                      still undecided. This helps us prepare for your appointment.
                    </Text>
                    {APPOINTMENT_PREP_ITEMS.map((item) => (
                      <Text
                        key={item.title}
                        className="m-0 mb-2.5"
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
            </EmailSectionWhite>

            {/* Cream — build process */}
            <EmailSectionLight>
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
                Our Custom Home Build Process
              </Text>
              {BUILD_PROCESS_STEPS.map((step, index) => (
                <ProcessStep
                  key={step.number}
                  number={step.number}
                  title={step.title}
                  description={step.description}
                  showBorder={index < BUILD_PROCESS_STEPS.length - 1}
                />
              ))}
              <EmailCtaButton href={bookingUrl} label="Book Consultation" align="center" />
            </EmailSectionLight>

            {/* White — testimonial */}
            <EmailSectionWhite style={{ padding: '2rem 1.5rem' }}>
              <Text
                className="m-0 mb-4 italic"
                style={{
                  fontFamily: FONTS.body,
                  fontWeight: 350,
                  fontSize: 14,
                  lineHeight: 1.75,
                  color: RC_COLORS.textMutedOnLight,
                }}
              >
                &ldquo;We built our first home with Royal Constructions and couldn&apos;t be happier.
                They delivered exactly what they promised — on time and with excellent quality.
                The whole process felt smooth, and we always felt looked after.&rdquo;
              </Text>
              <Text
                className="m-0"
                style={{
                  fontFamily: FONTS.condensed,
                  fontWeight: 500,
                  fontSize: 15,
                  color: RC_COLORS.gold,
                }}
              >
                Sajina B. — Oran Park, NSW
              </Text>
            </EmailSectionWhite>

            {/* White — book consultation (site-style light CTA, no navy block) */}
            <EmailSectionWhite style={{ padding: '2rem 1.5rem 2.5rem', textAlign: 'center' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.light,
                  borderRadius: 6,
                  border: `2px solid ${RC_COLORS.gold}`,
                  padding: '2rem 1.5rem',
                  textAlign: 'center',
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="m-0 mb-3 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 22,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      Book a Consultation
                    </Text>
                    <Text
                      className="m-0 mb-5"
                      style={{
                        fontFamily: FONTS.body,
                        fontSize: 14,
                        lineHeight: 1.65,
                        color: RC_COLORS.textMutedOnLight,
                        maxWidth: 440,
                        marginLeft: 'auto',
                        marginRight: 'auto',
                      }}
                    >
                      Get clear, obligation-free advice from an experienced builder who understands
                      your goals, site, and budget.
                    </Text>
                    <EmailCtaButton
                      href={bookingUrl}
                      label="Book Free Site Assessment"
                      align="center"
                    />
                  </Column>
                </Row>
              </Section>
            </EmailSectionWhite>

            {/* Cream — explore + sign-off */}
            <EmailSectionLight style={{ padding: '2rem 1.5rem 2.5rem' }}>
              <Text
                className="m-0 mb-2 uppercase"
                style={{
                  fontFamily: FONTS.condensed,
                  fontSize: 20,
                  color: RC_COLORS.textOnLight,
                }}
              >
                Explore more
              </Text>
              <Text className="m-0 mb-1" style={{ fontSize: 14 }}>
                <Link
                  href={RC_URLS.projects}
                  style={{ color: RC_COLORS.gold, textDecoration: 'none' }}
                >
                  View projects&nbsp;→
                </Link>
              </Text>
              <Text className="m-0 mb-6" style={{ fontSize: 14 }}>
                <Link
                  href={RC_URLS.customHomes}
                  style={{ color: RC_COLORS.gold, textDecoration: 'none' }}
                >
                  Custom homes&nbsp;→
                </Link>
              </Text>
              <Text
                className="m-0 mb-4"
                style={{
                  fontSize: 14,
                  lineHeight: 1.65,
                  color: RC_COLORS.textMutedOnLight,
                }}
              >
                Questions? Email{' '}
                <Link
                  href={`mailto:${RC_URLS.email}`}
                  style={{ color: RC_COLORS.gold, textDecoration: 'none' }}
                >
                  {RC_URLS.email}
                </Link>{' '}
                or call{' '}
                <Link
                  href={`tel:${RC_URLS.phone}`}
                  style={{ color: RC_COLORS.gold, textDecoration: 'none' }}
                >
                  {RC_URLS.phoneDisplay}
                </Link>
                .
              </Text>
              <Section style={{ borderTop: '1px solid #E2E8F0', paddingTop: '1.5rem' }}>
                <Row>
                  <Column>
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

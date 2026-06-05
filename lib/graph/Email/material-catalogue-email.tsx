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
  bricks: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='1' y='3' width='15' height='13'%3E%3C/rect%3E%3Cpolygon points='16 8 20 8 23 11 23 16 16 16 16 8'%3E%3C/polygon%3E%3Ccircle cx='5.5' cy='18.5' r='2.5'%3E%3C/circle%3E%3Ccircle cx='18.5' cy='18.5' r='2.5'%3E%3C/circle%3E%3C/svg%3E`,
  slab: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='3' y='3' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='3' y1='9' x2='21' y2='9'%3E%3C/line%3E%3Cline x1='9' y1='21' x2='9' y2='9'%3E%3C/line%3E%3C/svg%3E`,
  roofing: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'%3E%3C/path%3E%3Cpolyline points='9 22 9 12 15 12 15 22'%3E%3C/polyline%3E%3C/svg%3E`,
  fixtures: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='5'%3E%3C/circle%3E%3Cline x1='12' y1='1' x2='12' y2='3'%3E%3C/line%3E%3Cline x1='12' y1='21' x2='12' y2='23'%3E%3C/line%3E%3Cline x1='4.22' y1='4.22' x2='5.64' y2='5.64'%3E%3C/line%3E%3Cline x1='18.36' y1='18.36' x2='19.78' y2='19.78'%3E%3C/line%3E%3Cline x1='1' y1='12' x2='3' y2='12'%3E%3C/line%3E%3Cline x1='21' y1='12' x2='23' y2='12'%3E%3C/line%3E%3Cline x1='4.22' y1='19.78' x2='5.64' y2='18.36'%3E%3C/line%3E%3Cline x1='18.36' y1='5.64' x2='19.78' y2='4.22'%3E%3C/line%3E%3C/svg%3E`,
  kitchen: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24' fill='none' stroke='%23C6923A' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 8h1a4 4 0 0 1 0 8h-1'%3E%3C/path%3E%3Cpath d='M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z'%3E%3C/path%3E%3Cline x1='6' y1='1' x2='6' y2='4'%3E%3C/line%3E%3Cline x1='10' y1='1' x2='10' y2='4'%3E%3C/line%3E%3Cline x1='14' y1='1' x2='14' y2='4'%3E%3C/line%3E%3C/svg%3E`,
};

// ─── Sub-Components ─────────────────────────────────────────────────────────

function CategoryItem({
  icon,
  title,
  description,
  showBorder = true,
}: {
  icon: string;
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
          <Img
            alt=""
            height={26}
            src={icon}
            width={26}
            style={{ display: 'block', outline: 'none', border: 'none' }}
          />
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

// ─── Main Component ─────────────────────────────────────────────────────────

interface MaterialCatalogueEmailProps {
  name?: string;
  catalogueUrl?: string;
}

export default function MaterialCatalogueEmail({
  name = 'Homeowner',
  catalogueUrl = RC_URLS.catalogue,
}: MaterialCatalogueEmailProps) {
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
            Explore our material catalogue and choose your preferred finishes
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
                Material Catalogue
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
                Curate Your
                <br />
                Space
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
                Dear {name}, as discussed, it&apos;s time to bring your vision
                to life. Explore our curated material catalogue and select the
                premium finishes that will make your house truly feel like home.
              </Text>
            </EmailSectionLight>

            {/* ── Hero Image ── */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2rem' }}>
              <Img
                alt="Premium home finishes and materials"
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

            {/* ── Browse Catalogue CTA Card ── */}
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
                      Browse the material catalogue
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
                      Use the link below to explore our curated selection of
                      premium finishes and materials for your new home.
                    </Text>
                    <EmailCtaButton
                      href={catalogueUrl}
                      label="Browse Catalogue"
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
                      If you need help with your selections, reply to this email
                      and we will guide you through the options.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionWhite>

            {/* ── Selection Categories ── */}
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
                      Selection Categories
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
                      Explore each category and note your preferred options
                      before your next consultation.
                    </Text>
                  </Column>
                </Row>
                <CategoryItem
                  icon={ICONS.bricks}
                  title="Bricks & External Cladding"
                  description="Define the exterior character and street appeal of your new home."
                  showBorder
                />
                <CategoryItem
                  icon={ICONS.slab}
                  title="Slab & Foundation Options"
                  description="The structural backbone — ensure lasting quality from the ground up."
                  showBorder
                />
                <CategoryItem
                  icon={ICONS.roofing}
                  title="Roofing Materials"
                  description="Protect and crown your home with premium, durable roofing."
                  showBorder
                />
                <CategoryItem
                  icon={ICONS.fixtures}
                  title="Internal Fixtures & Fittings"
                  description="The finishing touches that complete every room with style."
                  showBorder
                />
                <CategoryItem
                  icon={ICONS.kitchen}
                  title="Kitchen & Bathroom Selections"
                  description="Choose the heart and sanctuary of your home — benchtops, tapware, and more."
                  showBorder={false}
                />
              </Section>
            </EmailSectionLight>

            {/* ── Variation Notice ── */}
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
                      Selecting premium finishes may apply variations to your
                      quotation. We will notify you of any{' '}
                      <span
                        style={{
                          color: RC_COLORS.gold,
                          fontWeight: 450,
                        }}
                      >
                        cost adjustments
                      </span>{' '}
                      before finalizing your selections.
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
                      We look forward to seeing your selections come together.
                    </Text>
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
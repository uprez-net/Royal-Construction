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

// ─── Sub-Components ─────────────────────────────────────────────────────────

function QuoteItem({
  label,
  amount,
  isBold = false,
  isTotal = false,
}: {
  label: string;
  amount: string;
  isBold?: boolean;
  isTotal?: boolean;
}) {
  return (
    <Row
      style={{
        padding: '12px 0',
        borderBottom: isTotal ? 'none' : '1px solid #E2E8F0',
      }}
    >
      <Column
        style={{
          fontFamily: FONTS.body,
          fontWeight: isBold ? 600 : 350,
          fontSize: isTotal ? 16 : 14,
          color: isTotal ? RC_COLORS.textOnLight : RC_COLORS.textMutedOnLight,
        }}
      >
        {label}
      </Column>
      <Column
        align="right"
        style={{
          fontFamily: FONTS.condensed,
          fontWeight: isBold ? 600 : 500,
          fontSize: isTotal ? 18 : 15,
          color: isTotal ? RC_COLORS.gold : RC_COLORS.textOnLight,
          letterSpacing: isTotal ? '-0.3px' : undefined,
        }}
      >
        {amount}
      </Column>
    </Row>
  );
}

function InclusionItem({
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
        <Column>
          <Text
            className="m-0 mb-1"
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
            className="m-0"
            style={{
              fontFamily: FONTS.body,
              fontWeight: 350,
              fontSize: 13,
              lineHeight: 1.6,
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

interface QuotationEmailProps {
  clientName?: string;
  projectName?: string;
  location?: string;
  quoteNumber?: string;
  items?: { label: string; amount: string }[];
  totalAmount?: string;
  validityPeriod?: string;
  quotationUrl?: string;
  leadContext?: LeadEmailContext;
}

export default function QuotationEmail({
  clientName = 'Homeowner',
  projectName = 'New Residence',
  location = 'Sydney, NSW',
  quoteNumber = 'RC-2026-001',
  items = [
    { label: 'Base Build – Double Storey 4BR + Study', amount: '$420,000' },
    { label: 'Site Works & Excavation', amount: '$25,000' },
    { label: 'Premium Facade Upgrade (Render + Brick Veneer)', amount: '$15,000' },
    { label: 'Timber Flooring Package', amount: '$8,500' },
    { label: 'Provisional Sum for Council Fees', amount: '$12,000' },
  ],
  totalAmount = '$480,500',
  validityPeriod = "30",
  quotationUrl = RC_URLS.quotation,
  leadContext,
}: QuotationEmailProps) {
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
            Your project quotation from Royal Constructions is ready for review.
            <div>&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿</div>
          </div>

          <Container
            className="max-w-[640px] mx-auto"
            style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}
          >
            <EmailHeader showGoldBar />

            {/* Hero */}
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
                Your Project
                <br />
                Quotation
              </Text>
              <Text
                className="m-0 mt-6"
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
                Dear {clientName}, please find below the quotation for your new home project. We are excited about the possibility of building with you.
              </Text>
            </EmailSectionLight>

            {/* Project Overview Card */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.light,
                  borderRadius: 6,
                  border: `1px solid #E2E8F0`,
                  padding: '1.5rem',
                }}
              >
                <Row>
                  <Column style={{ width: '50%', verticalAlign: 'top', paddingRight: '1rem' }}>
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
                      Project
                    </Text>
                    <Text
                      className="m-0"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 16,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      {projectName}
                    </Text>
                  </Column>
                  <Column style={{ width: '50%', verticalAlign: 'top' }}>
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
                      Location
                    </Text>
                    <Text
                      className="m-0"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 16,
                        color: RC_COLORS.textOnLight,
                      }}
                    >
                      {location}
                    </Text>
                  </Column>
                </Row>
                <Row style={{ marginTop: '1rem' }}>
                  <Column>
                    <Text
                      className="m-0 uppercase"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 500,
                        fontSize: 10,
                        letterSpacing: '0.8px',
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      Quotation No.
                    </Text>
                    <Text
                      className="m-0"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 16,
                        color: RC_COLORS.gold,
                      }}
                    >
                      {quoteNumber}
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionWhite>

            <EmailLeadContextSummary context={leadContext} />

            {/* Price Breakdown */}
            <EmailSectionLight style={{ padding: '2rem 1.5rem' }}>
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  borderRadius: 6,
                  border: '1px solid #E2E8F0',
                  padding: '1.5rem 2rem',
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="m-0 mb-4 uppercase"
                      style={{
                        fontFamily: FONTS.condensed,
                        fontWeight: 500,
                        fontSize: 22,
                        lineHeight: 1,
                        color: RC_COLORS.textOnLight,
                        letterSpacing: '0.3px',
                      }}
                    >
                      Price Breakdown
                    </Text>

                    {items.map((item) => (
                      <QuoteItem
                        key={item.label}
                        label={item.label}
                        amount={item.amount}
                      />
                    ))}

                    {/* Total Separator */}
                    <Section style={{ borderTop: `2px solid ${RC_COLORS.gold}`, marginTop: '1rem', paddingTop: '1rem' }}>
                      <QuoteItem label="Total Estimate" amount={totalAmount} isBold isTotal />
                    </Section>
                    
                    <Text
                      className="m-0 mt-4"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 350,
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      * All prices are in AUD and include GST unless otherwise noted. Provisional sums are estimates only and will be adjusted to actual costs.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* What's Included */}
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
                What is included
              </Text>
              <InclusionItem
                title="Fixed Price Contract"
                description="No hidden costs. The base build price is locked in, giving you certainty throughout the construction process."
                showBorder
              />
              <InclusionItem
                title="Council & Approvals Support"
                description="We handle the paperwork and liaise with certifiers and council on your behalf for DA/CC approvals."
                showBorder
              />
              <InclusionItem
                title="Dedicated Site Manager"
                description="An experienced Royal Constructions supervisor will oversee your project from start to handover."
                showBorder={false}
              />
            </EmailSectionWhite>

            {/* Quotation Validity Notice */}
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
                      This quotation is valid for <span style={{ fontWeight: 600, color: RC_COLORS.textOnLight }}>{validityPeriod}</span> from the date of issue. Pricing for materials and labour may be subject to change after this period.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* CTA */}
            <EmailSectionWhite style={{ padding: '0 1.5rem 2.5rem' }}>
              <Section style={{ textAlign: 'center' }}>
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
                  Ready to move forward? Review the full details and let us know if you have any questions.
                </Text>
                <EmailCtaButton href={quotationUrl} label="View Full Quotation" align="center" />
              </Section>
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
                      We look forward to turning your vision into reality.
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

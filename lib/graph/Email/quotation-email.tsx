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
} from "@react-email/components";
import {
  FONTS,
  RC_COLORS,
  RESPONSIVE_CSS,
  FONT_FACES_CSS,
  TAILWIND_CONFIG,
} from "./email-theme";
import { EmailFooter } from "./email-footer";
import { EmailHeader } from "./email-header";
import { EmailSectionLight } from "./email-section-light";
import { EmailSectionWhite } from "./email-section-white";
import {
  EmailLeadContextSummary,
  LeadEmailContext,
} from "./email-lead-context";

// ─── Style scale ────────────────────────────────────────────────────────────
//
// Every block below takes its type from TYPE and its panel chrome from CARD
// instead of re-declaring a near-identical inline style each time. That is what
// holds the email together: two section headings can't drift to different sizes,
// and a paragraph can't quietly end up at a different weight from the one beside
// it — which is how this template had ended up with 22px and 28px headings and
// four different paragraph treatments.

/** The light-theme hairline shared across the RC email templates. */
export const BORDER_ON_LIGHT = "#E2E8F0";

export const TYPE = {
  /** Hero headline. One per email. */
  display: {
    fontFamily: FONTS.condensed,
    fontWeight: 500,
    fontSize: 48,
    lineHeight: 1,
    letterSpacing: "-1.2px",
    color: RC_COLORS.textOnLight,
  },
  /** Every section heading. */
  sectionTitle: {
    fontFamily: FONTS.condensed,
    fontWeight: 500,
    fontSize: 24,
    lineHeight: 1.1,
    letterSpacing: "0.3px",
    color: RC_COLORS.textOnLight,
  },
  /** Heading of a row inside a list. */
  itemTitle: {
    fontFamily: FONTS.condensed,
    fontWeight: 500,
    fontSize: 15,
    lineHeight: 1.3,
    color: RC_COLORS.textOnLight,
  },
  /** Small uppercase eyebrow above a value. */
  label: {
    fontFamily: FONTS.body,
    fontWeight: 500,
    fontSize: 10,
    letterSpacing: "0.8px",
    color: RC_COLORS.textMutedOnLight,
  },
  /** The value under a label. */
  value: {
    fontFamily: FONTS.condensed,
    fontWeight: 500,
    fontSize: 16,
    lineHeight: 1.3,
    color: RC_COLORS.textOnLight,
  },
  /** Standard paragraph. */
  body: {
    fontFamily: FONTS.body,
    fontWeight: 350,
    fontSize: 14,
    lineHeight: 1.65,
    color: RC_COLORS.textMutedOnLight,
  },
  /** Secondary paragraph — notices, list descriptions. */
  bodySmall: {
    fontFamily: FONTS.body,
    fontWeight: 350,
    fontSize: 13,
    lineHeight: 1.6,
    color: RC_COLORS.textMutedOnLight,
  },
  /** Footnotes and disclaimers. */
  fine: {
    fontFamily: FONTS.body,
    fontWeight: 350,
    fontSize: 12,
    lineHeight: 1.5,
    color: RC_COLORS.textMutedOnLight,
  },
} as const;

// A panel is always the OPPOSITE tint of the band it sits on, and always carries
// the same hairline and radius — so a card reads as a card wherever it appears.
export const CARD = {
  borderRadius: 6,
  border: `1px solid ${BORDER_ON_LIGHT}`,
} as const;

// Vertical rhythm. A band that changes colour opens with its own top padding; a
// band continuing the colour above it opens flush, so the two read as one.
export const BAND = {
  full: "2.5rem 1.5rem",
  continues: "0 1.5rem 2.5rem",
} as const;

// ─── Sub-Components ─────────────────────────────────────────────────────────

function QuoteItem({
  label,
  amount,
  isTotal = false,
}: {
  label: string;
  amount: string;
  isTotal?: boolean;
}) {
  return (
    <Row
      style={{
        padding: "0.75rem 0",
        borderBottom: isTotal ? "none" : `1px solid ${BORDER_ON_LIGHT}`,
      }}
    >
      <Column
        style={
          isTotal
            ? {
                ...TYPE.body,
                fontWeight: 600,
                fontSize: 16,
                color: RC_COLORS.textOnLight,
              }
            : TYPE.body
        }
      >
        {label}
      </Column>
      <Column
        align="right"
        style={{
          fontFamily: FONTS.condensed,
          fontWeight: isTotal ? 600 : 500,
          fontSize: isTotal ? 18 : 15,
          color: isTotal ? RC_COLORS.gold : RC_COLORS.textOnLight,
          letterSpacing: isTotal ? "-0.3px" : undefined,
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
        padding: "1.25rem 0",
        borderBottom: showBorder ? `1px solid ${BORDER_ON_LIGHT}` : undefined,
      }}
    >
      <Row>
        <Column>
          <Text className="m-0 mb-1" style={TYPE.itemTitle}>
            {title}
          </Text>
          <Text className="m-0" style={TYPE.bodySmall}>
            {description}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

/** One label/value pair in the project overview card. */
function OverviewField({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <>
      <Text className="m-0 mb-1 uppercase" style={TYPE.label}>
        {label}
      </Text>
      <Text
        className="m-0"
        style={valueColor ? { ...TYPE.value, color: valueColor } : TYPE.value}
      >
        {value}
      </Text>
    </>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export interface QuotationEmailProps {
  clientName?: string;
  projectName?: string;
  location?: string;
  quoteNumber?: string;
  items?: { label: string; amount: string }[];
  totalAmount?: string;
  validityPeriod?: string;
  leadContext?: LeadEmailContext;
}

export default function QuotationEmail({
  clientName = "Homeowner",
  projectName = "New Residence",
  location = "Sydney, NSW",
  quoteNumber = "RC-2026-001",
  items = [
    { label: "Base Build – Double Storey 4BR + Study", amount: "$420,000" },
    { label: "Site Works & Excavation", amount: "$25,000" },
    {
      label: "Premium Facade Upgrade (Render + Brick Veneer)",
      amount: "$15,000",
    },
    { label: "Timber Flooring Package", amount: "$8,500" },
    { label: "Provisional Sum for Council Fees", amount: "$12,000" },
  ],
  totalAmount = "$480,500",
  validityPeriod = "30 days",
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
            Your project quotation from Royal Constructions is attached.
            <div>
              &nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿&nbsp;‌​‍‎‏﻿
            </div>
          </div>

          <Container
            className="max-w-[640px] mx-auto"
            style={{ backgroundColor: RC_COLORS.white, maxWidth: 640 }}
          >
            <EmailHeader showGoldBar />

            {/* Hero — cream band */}
            <EmailSectionLight style={{ padding: BAND.full }}>
              <Text
                className="mobile_font-40 m-0 uppercase"
                style={TYPE.display}
              >
                Your Project
                <br />
                Quotation
              </Text>
              <Text
                className="m-0 mt-6"
                style={{ ...TYPE.body, letterSpacing: "0.3px", maxWidth: 490 }}
              >
                Dear {clientName}, your quotation is summarised below, with the
                full proposal attached to this email as a PDF. We are excited
                about the possibility of building with you.
              </Text>
            </EmailSectionLight>

            {/* Project overview — white band, cream card */}
            <EmailSectionWhite style={{ padding: BAND.full }}>
              <Section
                style={{
                  ...CARD,
                  backgroundColor: RC_COLORS.light,
                  padding: "1.5rem",
                }}
              >
                <Row>
                  <Column
                    style={{
                      width: "50%",
                      verticalAlign: "top",
                      paddingRight: "1rem",
                    }}
                  >
                    <OverviewField label="Project" value={projectName} />
                  </Column>
                  <Column style={{ width: "50%", verticalAlign: "top" }}>
                    <OverviewField label="Location" value={location} />
                  </Column>
                </Row>
                <Row>
                  {/* Padding on the cell, not a margin on the row — Outlook drops
                      margins on a <tr>. */}
                  <Column style={{ paddingTop: "1rem" }}>
                    <OverviewField
                      label="Quotation No."
                      value={quoteNumber}
                      valueColor={RC_COLORS.gold}
                    />
                  </Column>
                </Row>
              </Section>
            </EmailSectionWhite>

            <EmailLeadContextSummary context={leadContext} />

            {/* Price breakdown — cream band, white card */}
            <EmailSectionLight style={{ padding: BAND.full }}>
              <Section
                style={{
                  ...CARD,
                  backgroundColor: RC_COLORS.white,
                  padding: "1.5rem 2rem",
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="m-0 mb-4 uppercase"
                      style={TYPE.sectionTitle}
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

                    <Section
                      style={{
                        borderTop: `2px solid ${RC_COLORS.gold}`,
                        marginTop: "1rem",
                        paddingTop: "1rem",
                      }}
                    >
                      <QuoteItem
                        label="Total Estimate"
                        amount={totalAmount}
                        isTotal
                      />
                    </Section>

                    <Text className="m-0 mt-4" style={TYPE.fine}>
                      * All prices are in AUD and include GST unless otherwise
                      noted. Provisional sums are estimates only and will be
                      adjusted to actual costs.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* What is included — white band, plain list */}
            <EmailSectionWhite style={{ padding: BAND.full }}>
              <Text className="m-0 mb-6 uppercase" style={TYPE.sectionTitle}>
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

            {/* Validity notice — cream band, white card with a gold rule */}
            <EmailSectionLight style={{ padding: BAND.full }}>
              <Section
                style={{
                  ...CARD,
                  backgroundColor: RC_COLORS.white,
                  borderLeft: `3px solid ${RC_COLORS.gold}`,
                  padding: "1rem 1.25rem",
                }}
              >
                <Row>
                  <Column>
                    <Text className="m-0" style={TYPE.bodySmall}>
                      This quotation is valid for{" "}
                      <span
                        style={{
                          fontWeight: 600,
                          color: RC_COLORS.textOnLight,
                        }}
                      >
                        {validityPeriod}
                      </span>{" "}
                      from the date of issue. Pricing for materials and labour
                      may be subject to change after this period.
                    </Text>
                  </Column>
                </Row>
              </Section>
            </EmailSectionLight>

            {/* Sign-off — continues the cream band above */}
            <EmailSectionLight style={{ padding: BAND.continues }}>
              <Section
                style={{
                  borderTop: `1px solid ${BORDER_ON_LIGHT}`,
                  paddingTop: "1.5rem",
                }}
              >
                <Row>
                  <Column>
                    <Text className="m-0 mb-5" style={TYPE.body}>
                      Please review the attached quotation and simply reply to
                      this email with any questions or changes — we look forward
                      to turning your vision into reality.
                    </Text>
                    <Text
                      className="m-0 mb-1"
                      style={{ ...TYPE.body, color: RC_COLORS.textOnLight }}
                    >
                      Warm regards,
                    </Text>
                    <Text
                      className="m-0"
                      style={{ ...TYPE.value, color: RC_COLORS.gold }}
                    >
                      Gurpinder Uppal
                    </Text>
                    <Text className="m-0" style={TYPE.bodySmall}>
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

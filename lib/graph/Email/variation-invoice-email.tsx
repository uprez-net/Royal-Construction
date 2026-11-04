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

import type { VariationDocumentData } from "@/lib/domain/ports/variation";

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
import { BAND, BORDER_ON_LIGHT, CARD, TYPE } from "./quotation-email";

// The email a variation goes out under. It follows the offer's quotation email
// band for band — cream hero, white overview card, cream price card, sign-off —
// so the client recognises it as the same builder writing about the same job.
// The document itself is attached; this summarises it.

const MONEY = new Intl.NumberFormat("en-AU", {
  currency: "AUD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});

const money = (cents: number) => MONEY.format(cents / 100);

const DAY = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "long",
  timeZone: "Australia/Sydney",
  year: "numeric",
});

function PriceLine({
  label,
  children,
  isTotal = false,
}: {
  label: string;
  children: React.ReactNode;
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
        }}
      >
        {children}
      </Column>
    </Row>
  );
}

function OverviewField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <Text className="m-0 mb-1 uppercase" style={TYPE.label}>
        {label}
      </Text>
      <Text className="m-0" style={TYPE.value}>
        {value}
      </Text>
    </>
  );
}

export type VariationInvoiceEmailProps = {
  readonly document: VariationDocumentData;
};

const SAMPLE: VariationDocumentData = {
  absorbedCents: 0,
  activityName: "Roof framing",
  chargeExGstCents: 250_000,
  chargeIncGstCents: 275_000,
  clientNames: "Jane Smith & John Smith",
  differenceCents: 250_000,
  dueDate: new Date("2026-11-15T00:00:00.000Z"),
  greetingName: "Jane Smith",
  gstCents: 25_000,
  invoiceNumber: "INV-0042",
  kind: "CHARGEABLE",
  newPriceCents: 1_250_000,
  number: "V-003",
  previousPriceCents: 1_000_000,
  projectName: "Smith Residence",
  raisedDate: new Date("2026-11-01T00:00:00.000Z"),
  reason: "Upgrade to a hipped roof at the owners' request.",
  siteAddress: "12 Smith St, Parramatta NSW",
  stageLabel: "Frame",
};

export default function VariationInvoiceEmail({
  document = SAMPLE,
}: Partial<VariationInvoiceEmailProps>) {
  const promotional = document.kind === "PROMOTIONAL";
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
            Variation {document.number} for {document.siteAddress} is attached.
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
                Contract
                <br />
                Variation
              </Text>
              <Text
                className="m-0 mt-6"
                style={{ ...TYPE.body, letterSpacing: "0.3px", maxWidth: 490 }}
              >
                Dear {document.greetingName},{" "}
                {promotional
                  ? "we have updated the price of one activity on your build, and Royal Constructions is covering the difference in full. There is nothing for you to pay."
                  : "we have updated the price of one activity on your build. The details are summarised below, with the variation document attached as a PDF."}
              </Text>
            </EmailSectionLight>

            {/* Overview — white band, cream card */}
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
                    <OverviewField label="Site" value={document.siteAddress} />
                  </Column>
                  <Column style={{ width: "50%", verticalAlign: "top" }}>
                    <OverviewField
                      label="Activity"
                      value={document.activityName}
                    />
                  </Column>
                </Row>
                <Row>
                  <Column
                    style={{
                      width: "50%",
                      verticalAlign: "top",
                      paddingRight: "1rem",
                      paddingTop: "1rem",
                    }}
                  >
                    <OverviewField
                      label="Variation No."
                      value={document.number}
                    />
                  </Column>
                  <Column
                    style={{
                      width: "50%",
                      verticalAlign: "top",
                      paddingTop: "1rem",
                    }}
                  >
                    <OverviewField
                      label="Date raised"
                      value={DAY.format(document.raisedDate)}
                    />
                  </Column>
                </Row>
              </Section>
              <Text className="m-0 mt-6 mb-2 uppercase" style={TYPE.label}>
                Reason for this variation
              </Text>
              <Text className="m-0" style={TYPE.body}>
                {document.reason}
              </Text>
            </EmailSectionWhite>

            {/* Price — cream band, white card */}
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
                      Price change
                    </Text>
                    <PriceLine label="Quoted price (ex GST)">
                      <span
                        style={{
                          textDecoration: "line-through",
                          color: RC_COLORS.textMutedOnLight,
                        }}
                      >
                        {money(document.previousPriceCents)}
                      </span>
                    </PriceLine>
                    <PriceLine label="New price (ex GST)">
                      {money(document.newPriceCents)}
                    </PriceLine>
                    <PriceLine label="Variation amount (ex GST)">
                      +{money(document.differenceCents)}
                    </PriceLine>
                    {promotional ? (
                      <PriceLine label="Covered by Royal Constructions">
                        −{money(document.absorbedCents)}
                      </PriceLine>
                    ) : (
                      <PriceLine label="GST (10%)">
                        {money(document.gstCents)}
                      </PriceLine>
                    )}
                    <Section
                      style={{
                        borderTop: `2px solid ${RC_COLORS.gold}`,
                        marginTop: "1rem",
                        paddingTop: "1rem",
                      }}
                    >
                      <PriceLine
                        label={
                          promotional
                            ? "Total payable by you"
                            : "Total payable (inc GST)"
                        }
                        isTotal
                      >
                        {money(document.chargeIncGstCents)}
                      </PriceLine>
                    </Section>
                    {!promotional
                    && (document.invoiceNumber || document.dueDate) ? (
                      <Text className="m-0 mt-4" style={TYPE.fine}>
                        {document.invoiceNumber
                          ? `Invoice ${document.invoiceNumber}`
                          : "Invoice"}
                        {document.dueDate
                          ? `, due ${DAY.format(document.dueDate)}`
                          : ""}
                        . Please quote{" "}
                        {document.invoiceNumber
                          ? "this number"
                          : "the variation number"}{" "}
                        when you pay.
                      </Text>
                    ) : null}
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
                      Please review the attached variation and simply reply to
                      this email with any questions.
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

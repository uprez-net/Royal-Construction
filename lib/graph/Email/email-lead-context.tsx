import { Column, Row, Section, Text } from '@react-email/components';
import { FONTS, RC_COLORS } from './email-theme';

export interface LeadEmailContext {
  projectType?: string;
  location?: string;
  source?: string;
  stage?: string;
  budget?: string;
  followup?: string;
  assignee?: string;
  notes?: string;
}

function hasValue(value: string | null | undefined) {
  return Boolean(value && value.trim() && value !== 'Not Discussed');
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <Row>
      <Column style={{ width: '34%', padding: '0.35rem 0.75rem 0.35rem 0' }}>
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
          {label}
        </Text>
      </Column>
      <Column style={{ padding: '0.35rem 0' }}>
        <Text
          className="m-0"
          style={{
            fontFamily: FONTS.body,
            fontWeight: 400,
            fontSize: 13,
            lineHeight: 1.5,
            color: RC_COLORS.textOnLight,
          }}
        >
          {value}
        </Text>
      </Column>
    </Row>
  );
}

export function EmailLeadContextSummary({
  context,
}: {
  context?: LeadEmailContext;
}) {
  if (!context) return null;

  const details = [
    ['Project type', context.projectType],
    ['Location', context.location],
    ['Source', context.source],
    ['Lead stage', context.stage],
    ['Budget', context.budget],
    ['Follow-up', context.followup],
    ['Assigned to', context.assignee],
  ].filter((detail): detail is [string, string] => hasValue(detail[1]));

  const notes = context.notes?.trim();

  if (details.length === 0 && !notes) return null;

  return (
    <Section style={{ padding: '0 1.5rem 2rem' }}>
      <Section
        style={{
          backgroundColor: RC_COLORS.white,
          borderRadius: 6,
          border: '1px solid #E2E8F0',
          padding: '1.25rem 1.5rem',
        }}
      >
        <Text
          className="m-0 mb-3 uppercase"
          style={{
            fontFamily: FONTS.condensed,
            fontWeight: 500,
            fontSize: 16,
            lineHeight: 1,
            letterSpacing: '0.4px',
            color: RC_COLORS.gold,
          }}
        >
          Project snapshot
        </Text>
        {details.map(([label, value]) => (
          <DetailRow key={label} label={label} value={value} />
        ))}
        {notes && (
          <Section
            style={{
              borderTop: details.length ? '1px solid #E2E8F0' : undefined,
              marginTop: details.length ? '0.75rem' : 0,
              paddingTop: details.length ? '0.75rem' : 0,
            }}
          >
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
              Notes from the lead
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
              {notes}
            </Text>
          </Section>
        )}
      </Section>
    </Section>
  );
}

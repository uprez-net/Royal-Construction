import { Link, Section, Row, Column } from '@react-email/components';
import { FONTS, RC_COLORS } from './email-theme';

interface EmailCtaButtonProps {
  href: string;
  label: string;
  align?: 'left' | 'center';
}

/** Table-based gold CTA — matches site ENQUIRE / BOOK buttons (Outlook-safe). */
export function EmailCtaButton({ href, label, align = 'left' }: EmailCtaButtonProps) {
  return (
    <Section style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
      <Row>
        <Column align={align}>
          <table
            border={0}
            cellPadding={0}
            cellSpacing={0}
            role="presentation"
            style={{ margin: align === 'center' ? '0 auto' : undefined }}
          >
            <tbody>
              <tr>
                <td
                  style={{
                    backgroundColor: RC_COLORS.gold,
                    borderRadius: 6,
                    textAlign: 'center',
                  }}
                >
                  <Link
                    href={href}
                    target="_blank"
                    style={{
                      display: 'inline-block',
                      padding: '16px 48px',
                      fontFamily: FONTS.condensed,
                      fontWeight: 500,
                      fontSize: 15,
                      lineHeight: 1,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      color: RC_COLORS.ctaText,
                      textDecoration: 'none',
                    }}
                  >
                    {label}
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </Column>
      </Row>
    </Section>
  );
}

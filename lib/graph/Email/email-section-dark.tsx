import { Section, Row, Column } from '@react-email/components';
import { RC_COLORS } from './email-theme';
import type { ReactNode } from 'react';

interface EmailSectionDarkProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Navy accent band — use sparingly (e.g. final CTA), like site footer contrast. */
export function EmailSectionDark({ children, className = '', style }: EmailSectionDarkProps) {
  return (
    <Section
      className={`mobile_px-4 ${className}`.trim()}
      style={{
        backgroundColor: RC_COLORS.dark,
        padding: '2.5rem 1.5rem',
        ...style,
      }}
    >
      <Row>
        <Column>{children}</Column>
      </Row>
    </Section>
  );
}

import { Section, Row, Column } from '@react-email/components';
import { RC_COLORS } from './email-theme';
import type { ReactNode } from 'react';

interface EmailSectionWhiteProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** White content band — alternates with cream for clear section breaks on site. */
export function EmailSectionWhite({ children, className = '', style }: EmailSectionWhiteProps) {
  return (
    <Section
      className={`mobile_px-4 ${className}`.trim()}
      style={{
        backgroundColor: RC_COLORS.white,
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

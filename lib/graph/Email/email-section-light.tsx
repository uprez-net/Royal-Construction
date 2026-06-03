import { Section, Row, Column } from '@react-email/components';
import { RC_COLORS } from './email-theme';
import type { ReactNode } from 'react';

interface EmailSectionLightProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Cream content band — matches website body sections on custom-homes. */
export function EmailSectionLight({ children, className = '', style }: EmailSectionLightProps) {
  return (
    <Section
      className={`mobile_px-4 ${className}`.trim()}
      style={{
        backgroundColor: RC_COLORS.light,
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

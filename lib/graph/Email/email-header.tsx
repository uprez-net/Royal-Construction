import { Section, Row, Column, Link, Img } from '@react-email/components';
import { RC_URLS, RC_COLORS, LOGO_EMAIL } from './email-theme';

interface EmailHeaderProps {
  logoWidth?: number;
  showGoldBar?: boolean;
}

export function EmailHeader({
  logoWidth = LOGO_EMAIL.width,
  showGoldBar = false,
}: EmailHeaderProps) {
  const logoHeight = Math.round((logoWidth * LOGO_EMAIL.height) / LOGO_EMAIL.width);

  return (
    <>
      <Section
        style={{
          backgroundColor: RC_COLORS.white,
          margin: 0,
          padding: 0,
        }}
      >
        <Row>
          <Column align="center" style={{ padding: '24px 24px 20px', textAlign: 'center' }}>
            <Link href={RC_URLS.website} target="_blank" style={{ textDecoration: 'none' }}>
              <Img
                alt="Royal Constructions"
                src={RC_URLS.logo}
                width={logoWidth}
                height={logoHeight}
                style={{
                  display: 'block',
                  margin: '0 auto',
                  width: logoWidth,
                  height: logoHeight,
                  maxWidth: logoWidth,
                  outline: 'none',
                  border: 'none',
                  textDecoration: 'none',
                }}
              />
            </Link>
          </Column>
        </Row>
      </Section>
      {showGoldBar ? (
        <Section style={{ margin: 0, padding: 0, lineHeight: 0 }}>
          <Row>
            <Column
              style={{
                backgroundColor: RC_COLORS.gold,
                height: 3,
                fontSize: 0,
                lineHeight: 0,
              }}
            >
              &nbsp;
            </Column>
          </Row>
        </Section>
      ) : null}
    </>
  );
}

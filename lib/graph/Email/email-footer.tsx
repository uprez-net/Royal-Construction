import { Section, Row, Column, Text, Link, Img } from '@react-email/components';
import { FONTS, RC_URLS, RC_COLORS, LOGO_EMAIL } from './email-theme';

const FOOTER_LOGO_HEIGHT = Math.round((110 * LOGO_EMAIL.height) / LOGO_EMAIL.width);

export function EmailFooter() {
  return (
    <Section
      style={{
        backgroundColor: RC_COLORS.light,
        borderTop: `3px solid ${RC_COLORS.gold}`,
        margin: 0,
        padding: 0,
      }}
    >
      <Row>
        <Column className="mobile_px-4 mobile_py-12" style={{ padding: '2.5rem 1.5rem' }}>
          <Row>
            <Column
              className="mobile_footer_left"
              width="55%"
              style={{ verticalAlign: 'top', paddingRight: '1.5rem' }}
            >
              <Link href={RC_URLS.website} target="_blank" style={{ textDecoration: 'none' }}>
                <Img
                  alt="Royal Constructions"
                  src={RC_URLS.logo}
                  width={110}
                  height={FOOTER_LOGO_HEIGHT}
                  style={{
                    display: 'block',
                    width: 110,
                    height: FOOTER_LOGO_HEIGHT,
                    marginBottom: 20,
                    outline: 'none',
                    border: 'none',
                  }}
                />
              </Link>

              <Text
                className="m-0 mb-5"
                style={{
                  fontFamily: FONTS.body,
                  fontWeight: 350,
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: RC_COLORS.textMutedOnLight,
                  maxWidth: 300,
                }}
              >
                Royal Constructions — Building exceptional homes across NSW with quality
                craftsmanship and attention to detail.
              </Text>

              <Text className="m-0 mb-6" style={{ fontSize: 14, lineHeight: 1.5 }}>
                <Link
                  href={RC_URLS.facebookPage}
                  target="_blank"
                  style={{
                    color: RC_COLORS.gold,
                    textDecoration: 'none',
                    fontFamily: FONTS.body,
                    fontWeight: 500,
                  }}
                >
                  Facebook
                </Link>
                <span style={{ color: RC_COLORS.textMutedOnLight, margin: '0 10px' }}>·</span>
                <Link
                  href={RC_URLS.instagramPage}
                  target="_blank"
                  style={{
                    color: RC_COLORS.gold,
                    textDecoration: 'none',
                    fontFamily: FONTS.body,
                    fontWeight: 500,
                  }}
                >
                  Instagram
                </Link>
              </Text>

              <Text
                className="m-0 mb-4"
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: RC_COLORS.textMutedOnLight,
                }}
              >
                <span style={{ color: RC_COLORS.textOnLight, fontWeight: 500 }}>Office</span>
                <br />
                38/62 Turner RD
                <br />
                Smeaton Grange, NSW 2567
              </Text>

              <Text
                className="m-0 mb-5"
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: RC_COLORS.textMutedOnLight,
                }}
              >
                <span style={{ color: RC_COLORS.textOnLight, fontWeight: 500 }}>Contact</span>
                <br />
                <Link
                  href={`tel:${RC_URLS.phone}`}
                  style={{ color: RC_COLORS.textMutedOnLight, textDecoration: 'none' }}
                >
                  {RC_URLS.phoneDisplay}
                </Link>
                <br />
                <Link
                  href={`mailto:${RC_URLS.email}`}
                  style={{ color: RC_COLORS.textMutedOnLight, textDecoration: 'none' }}
                >
                  {RC_URLS.email}
                </Link>
              </Text>

              <Text
                className="m-0"
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: RC_COLORS.textMutedOnLight,
                }}
              >
                <Link
                  href={RC_URLS.privacy}
                  style={{ color: RC_COLORS.gold, textDecoration: 'underline' }}
                >
                  Privacy Policy
                </Link>
                {' · '}
                <Link href="#" style={{ color: RC_COLORS.gold, textDecoration: 'underline' }}>
                  Unsubscribe
                </Link>{' '}
                from Royal Constructions marketing emails.
              </Text>
            </Column>

            <Column
              className="mobile_footer_right"
              width="45%"
              style={{ verticalAlign: 'top' }}
            >
              <Section
                style={{
                  backgroundColor: RC_COLORS.white,
                  borderRadius: 6,
                  border: '1px solid #E2E8F0',
                  padding: '1.25rem',
                }}
              >
                <Row>
                  <Column>
                    <Text
                      className="m-0 mb-4 uppercase"
                      style={{
                        fontFamily: FONTS.body,
                        fontWeight: 500,
                        fontSize: 10,
                        letterSpacing: '0.8px',
                        color: RC_COLORS.textMutedOnLight,
                      }}
                    >
                      Accredited by
                    </Text>
                    <Link href={RC_URLS.website} target="_blank" style={{ textDecoration: 'none' }}>
                      <Img
                        alt="Master Builders Association"
                        src={RC_URLS.mbaLogo}
                        width={100}
                        height={40}
                        style={{
                          display: 'block',
                          width: 100,
                          height: 'auto',
                          maxHeight: 48,
                          marginBottom: 16,
                          outline: 'none',
                          border: 'none',
                        }}
                      />
                    </Link>
                    <Link href={RC_URLS.website} target="_blank" style={{ textDecoration: 'none' }}>
                      <Img
                        alt="Oran Park"
                        src={RC_URLS.oranPark}
                        width={120}
                        height={36}
                        style={{
                          display: 'block',
                          width: 120,
                          height: 'auto',
                          maxHeight: 40,
                          outline: 'none',
                          border: 'none',
                        }}
                      />
                    </Link>
                  </Column>
                </Row>
              </Section>
            </Column>
          </Row>
        </Column>
      </Row>
    </Section>
  );
}

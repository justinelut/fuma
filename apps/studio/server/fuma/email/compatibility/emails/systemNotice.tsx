import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email'

const SYSTEM_NOTICE_PREVIEW_PROPS = Object.freeze({
  actionUrl: 'https://app.fuma.invalid/notices/notice_041',
  logoUrl: 'https://cdn.fuma.invalid/email/logo.png',
  recipientName: 'Amina',
})

type SystemNoticeEmailProps = typeof SYSTEM_NOTICE_PREVIEW_PROPS

export default function SystemNoticeEmail({
  actionUrl = SYSTEM_NOTICE_PREVIEW_PROPS.actionUrl,
  logoUrl = SYSTEM_NOTICE_PREVIEW_PROPS.logoUrl,
  recipientName = SYSTEM_NOTICE_PREVIEW_PROPS.recipientName,
}: Partial<SystemNoticeEmailProps> = {}) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Fuma workspace is ready for review</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Section style={headerStyle}>
            <Img
              src={logoUrl}
              width="120"
              height="32"
              alt="Fuma"
              style={logoStyle}
            />
          </Section>
          <Section style={contentStyle}>
            <Heading as="h1" style={headingStyle}>Workspace ready</Heading>
            <Text style={paragraphStyle}>Hello {recipientName},</Text>
            <Text style={paragraphStyle}>
              Your workspace passed its checks and is ready for a final review.
            </Text>
            <Button href={actionUrl} style={buttonStyle}>Review workspace</Button>
            <Hr style={ruleStyle} />
            <Row>
              <Column style={labelColumnStyle}>
                <Text style={labelStyle}>Status</Text>
              </Column>
              <Column>
                <Text style={valueStyle}>Ready for review</Text>
              </Column>
            </Row>
            <Text style={fallbackStyle}>
              If the button does not work, open{' '}
              <Link href={actionUrl} style={linkStyle}>{actionUrl}</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

SystemNoticeEmail.PreviewProps = SYSTEM_NOTICE_PREVIEW_PROPS

const bodyStyle = {
  backgroundColor: '#f3f4f6',
  color: '#171717',
  fontFamily: 'Arial, Helvetica, sans-serif',
  margin: '0',
  padding: '24px 0',
}

const containerStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #dedede',
  margin: '0 auto',
  maxWidth: '600px',
}

const headerStyle = {
  padding: '24px 32px 16px',
}

const logoStyle = {
  border: '0',
  display: 'block',
  height: '32px',
  outline: 'none',
  textDecoration: 'none',
  width: '120px',
}

const contentStyle = {
  padding: '8px 32px 32px',
}

const headingStyle = {
  fontSize: '24px',
  lineHeight: '32px',
  margin: '0 0 20px',
}

const paragraphStyle = {
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 16px',
}

const buttonStyle = {
  backgroundColor: '#171717',
  borderRadius: '4px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '16px',
  fontWeight: '700',
  lineHeight: '20px',
  margin: '8px 0 24px',
  padding: '12px 20px',
  textDecoration: 'none',
}

const ruleStyle = {
  borderColor: '#dedede',
  margin: '0 0 20px',
}

const labelColumnStyle = {
  width: '35%',
}

const labelStyle = {
  color: '#525252',
  fontSize: '14px',
  lineHeight: '20px',
  margin: '0',
}

const valueStyle = {
  fontSize: '14px',
  fontWeight: '700',
  lineHeight: '20px',
  margin: '0',
}

const fallbackStyle = {
  color: '#525252',
  fontSize: '12px',
  lineHeight: '18px',
  margin: '24px 0 0',
  wordBreak: 'break-all' as const,
}

const linkStyle = {
  color: '#171717',
  textDecoration: 'underline',
}

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components"

interface VerifyEmailProps {
  verificationUrl: string
}

export const VerifyEmail = ({
  verificationUrl
}: VerifyEmailProps) => (
  <Html>
    <Head />
    <Preview>
      Verify your SparkFeed account
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>
          Verify your email
        </Heading>
        <Section style={section}>
          <Text style={text}>
            Thanks for signing up for SparkFeed!
            Click the button below to verify
            your email address and get started.
          </Text>
          <Button
            style={button}
            href={verificationUrl}>
            Verify my account
          </Button>
          <Text style={text}>
            Or copy and paste this URL into
            your browser:{" "}
            <a href={verificationUrl} style={link}>
              {verificationUrl}
            </a>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            This link expires in 24 hours.
            If you did not create a SparkFeed
            account you can safely ignore
            this email.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default VerifyEmail

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
}
const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
}
const heading = {
  fontSize: "24px",
  letterSpacing: "-0.5px",
  lineHeight: "1.3",
  fontWeight: "400",
  color: "#484848",
  padding: "17px 0 0",
  textAlign: "center" as const,
}
const section = {
  padding: "0 48px",
}
const text = {
  color: "#525f7f",
  fontSize: "16px",
  lineHeight: "24px",
  textAlign: "left" as const,
}
const button = {
  backgroundColor: "#7c3aed",
  borderRadius: "5px",
  color: "#fff",
  fontSize: "16px",
  fontWeight: "bold",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "block",
  padding: "12px",
  marginTop: "20px",
  marginBottom: "20px",
}
const link = {
  color: "#7c3aed",
  textDecoration: "underline",
}
const hr = {
  borderColor: "#e6ebf1",
  margin: "20px 0",
}
const footer = {
  color: "#8898aa",
  fontSize: "12px",
  lineHeight: "16px",
}

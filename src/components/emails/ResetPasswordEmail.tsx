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
} from "@react-email/components";

interface ResetPasswordEmailProps {
  resetUrl: string;
}

export const ResetPasswordEmail = ({ resetUrl }: ResetPasswordEmailProps) => (
  <Html>
    <Head />
    <Preview>Reset your SparkFeed password</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={heading}>Password Reset Request</Heading>
        <Section style={section}>
          <Text style={text}>
            Click the button below to reset your password:
          </Text>
          <Button style={button} href={resetUrl}>
            Reset Password
          </Button>
          <Text style={text}>
            Or copy and paste this URL into your browser:{" "}
            <a href={resetUrl} style={link}>
              {resetUrl}
            </a>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export default ResetPasswordEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
};

const heading = {
  fontSize: "24px",
  letterSpacing: "-0.5px",
  lineHeight: "1.3",
  fontWeight: "400",
  color: "#484848",
  padding: "17px 0 0",
  textAlign: "center" as const,
};

const section = {
  padding: "0 48px",
};

const text = {
  color: "#525f7f",
  fontSize: "16px",
  lineHeight: "24px",
  textAlign: "left" as const,
};

const button = {
  backgroundColor: "#2563eb",
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
};

const link = {
  color: "#2563eb",
  textDecoration: "underline",
};

const hr = {
  borderColor: "#e6ebf1",
  margin: "20px 0",
};

const footer = {
  color: "#8898aa",
  fontSize: "12px",
  lineHeight: "16px",
};

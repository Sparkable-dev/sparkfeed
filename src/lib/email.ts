import { render } from "@react-email/components"
import React from "react"
import { InviteEmail } from "@/components/emails/InviteEmail"
import { ResetPasswordEmail } from "@/components/emails/ResetPasswordEmail"
import { VerifyEmail } from "@/components/emails/VerifyEmail"

const fromEmail = process.env.EMAIL_FROM ?? "SparkFeed <no-reply@sparkfeed.dev>"

// Sends an email using Resend (priority 1) or SMTP (priority 2).
// If neither is configured, logs a warning and skips silently.
async function sendEmail(to: string, subject: string, html: string) {
  if (typeof window !== "undefined") return

  // 1. Resend
  if (process.env.RESEND_API_KEY) {
    const { Resend } = await import("resend")
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { error } = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
    })
    if (error) throw error
    return
  }

  // 2. SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const nodemailer = await import("nodemailer")
    const transporter = nodemailer.default.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        ciphers: "SSLv3",
        rejectUnauthorized: process.env.SMTP_IGNORE_TLS !== "true",
      },
    })
    await transporter.sendMail({ from: fromEmail, to, subject, html })
    return
  }

  console.warn(
    "[email] No email provider configured. " +
      "Set RESEND_API_KEY, or set SMTP_HOST + SMTP_USER + SMTP_PASS."
  )
}

export async function sendInviteEmail(toEmail: string, inviteUrl: string) {
  const html = await render(React.createElement(InviteEmail, { inviteUrl }))
  await sendEmail(toEmail, "You're invited to join SparkFeed", html)
}

export async function sendPasswordResetEmail(
  toEmail: string,
  resetUrl: string
) {
  const html = await render(
    React.createElement(ResetPasswordEmail, { resetUrl })
  )
  await sendEmail(toEmail, "Reset your SparkFeed password", html)
}

export async function sendVerificationEmail(
  toEmail: string,
  verificationUrl: string
) {
  const html = await render(
    React.createElement(VerifyEmail, { verificationUrl })
  )
  await sendEmail(toEmail, "Verify your SparkFeed account", html)
}

export async function sendTwoFactorOtpEmail(toEmail: string, otp: string) {
  const safeOtp = escapeHtml(otp)
  const html = [
    `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b">`,
    `<h1 style="font-size:24px;margin:0 0 16px">Sparkfeed Admin sign-in code</h1>`,
    `<p style="font-size:16px;line-height:24px;margin:0 0 20px">Enter this code to continue to the admin panel:</p>`,
    `<p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;margin:0 0 20px">${safeOtp}</p>`,
    `<p style="font-size:14px;line-height:20px;color:#71717a;margin:0">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>`,
    `</div>`,
  ].join("")
  await sendEmail(toEmail, "Your Sparkfeed Admin sign-in code", html)
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

export async function sendTeamRequestNotification(input: {
  requesterName: string
  requesterEmail: string
  workspaceName: string
  requestType: string
  expectedSeats: number | null
  message: string
}) {
  const to = process.env.TEAM_REQUEST_TO ?? "hello@sparkable.dev"
  const html = [
    `<h1>Workspace request</h1>`,
    `<p><strong>Requester:</strong> ${escapeHtml(input.requesterName)} (${escapeHtml(input.requesterEmail)})</p>`,
    `<p><strong>Workspace:</strong> ${escapeHtml(input.workspaceName)}</p>`,
    `<p><strong>Type:</strong> ${escapeHtml(input.requestType)}</p>`,
    `<p><strong>Expected seats:</strong> ${input.expectedSeats ?? "Not specified"}</p>`,
    input.message
      ? `<p><strong>Notes:</strong><br>${escapeHtml(input.message).replaceAll("\n", "<br>")}</p>`
      : "",
  ].join("")
  await sendEmail(to, `Sparkfeed request: ${input.workspaceName}`, html)
}

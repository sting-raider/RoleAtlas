import "server-only";

import nodemailer from "nodemailer";

type AuthEmail = {
  to: string;
  subject: string;
  text: string;
};

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

function smtpTransport() {
  if (transport) return transport;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;

  transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === "true",
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD ?? "",
          },
        }
      : {}),
  });
  return transport;
}

export function authEmailIsConfigured() {
  return Boolean(process.env.SMTP_HOST?.trim());
}

export async function sendAuthEmail(message: AuthEmail) {
  const sender = smtpTransport();
  if (!sender) {
    throw new Error("Authentication email delivery is not configured.");
  }
  await sender.sendMail({
    from: process.env.AUTH_EMAIL_FROM ?? "RoleAtlas <no-reply@roleatlas.local>",
    ...message,
  });
}

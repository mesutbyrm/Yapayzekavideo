import nodemailer from "nodemailer";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

let transport: nodemailer.Transporter | null = null;

export function emailConfigured() {
  return !!env().SMTP_HOST;
}

export async function sendEmail(to: string, subject: string, text: string) {
  const e = env();
  if (!e.SMTP_HOST) {
    logger.info({ subject }, "SMTP yapılandırılmadı, e-posta atlandı");
    return false;
  }
  transport ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: e.SMTP_FROM, to, subject, text });
  return true;
}

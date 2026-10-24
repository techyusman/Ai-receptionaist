// Transactional email through Resend, from the restaurant platform's own verified domain.
import { Resend } from "resend";
import type { EmailMessage, EmailSender } from "./email.ts";

export function createResend(apiKey: string, from: string): EmailSender {
  const client = new Resend(apiKey);
  return {
    async send(m: EmailMessage) {
      const { error } = await client.emails.send({ from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
      if (error) throw new Error(`Resend refused the email: ${error.message}`);
    },
  };
}

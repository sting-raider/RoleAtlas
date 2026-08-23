//! Pluggable notification delivery channels.
//!
//! In-app records in PostgreSQL remain the authoritative product surface; this
//! module only carries *copies* outward. Transports never run implicitly: the
//! digest route constructs one explicitly, so tests inject a recorder and no
//! test or development environment can send real email by accident.

export type OutboundMessage = {
  to: string;
  subject: string;
  text: string;
};

export type DeliveryResult = { delivered: true; messageId?: string } | { delivered: false; error: string };

/** Structural subset of nodemailer's transport factory used here. */
export interface MailerLike {
  createTransport: (options: unknown) => {
    sendMail: (mail: Record<string, string>) => Promise<{ messageId?: string }>;
  };
}

export interface NotificationTransport {
  readonly kind: "smtp" | "capture";
  send(message: OutboundMessage): Promise<DeliveryResult>;
}

/** Development/testing transport: keeps the message in memory. */
export class CaptureTransport implements NotificationTransport {
  readonly kind = "capture" as const;
  readonly sent: OutboundMessage[] = [];

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    return { delivered: true };
  }
}

/** Production transport over SMTP (Mailpit captures locally in development). */
export class SmtpTransport implements NotificationTransport {
  readonly kind = "smtp" as const;
  private readonly url: string;
  private readonly from: string;
  private readonly mailer?: MailerLike;

  constructor(url: string, from: string, mailer?: MailerLike) {
    this.url = url;
    this.from = from;
    this.mailer = mailer;
  }

  static fromEnv(mailer?: MailerLike): SmtpTransport | null {
    const url = process.env.NOTIFICATIONS_SMTP_URL ?? process.env.SMTP_URL ?? "";
    if (!url.trim()) return null;
    return new SmtpTransport(url, process.env.NOTIFICATIONS_SMTP_FROM ?? "RoleAtlas <no-reply@localhost>", mailer);
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    try {
      const mailer =
        this.mailer ??
        ((await import("nodemailer")).default as unknown as MailerLike);
      const transport = mailer.createTransport(this.url);
      const result = await transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      return { delivered: true, messageId: result.messageId };
    } catch (error) {
      return { delivered: false, error: error instanceof Error ? error.message : "smtp failed" };
    }
  }
}

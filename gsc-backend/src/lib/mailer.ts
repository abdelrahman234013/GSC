import { Resend } from "resend";

// Built on first send, not at import.
//
// `new Resend(key)` throws when the key is missing, and doing that at module load
// meant the whole process died on startup — before serving anything — just
// because email was not configured. A developer working on the catalogue could
// not run the API without a Resend account.
//
// Deferring it means the app boots, and only the paths that actually send mail
// fail. Every caller already treats a send failure as non-fatal (see
// lib/notifications.ts and the register/reset flows), so an unconfigured mailer
// degrades to "email doesn't go out" rather than "the site is down".
let cachedClient: Resend | null = null;

function client(): Resend {
  if (cachedClient) return cachedClient;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      "Email is not configured: set RESEND_API_KEY. No message was sent.",
    );
  }

  cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendEmail(to, subject, body) {
  await client().emails.send({
    // NOTE: onboarding@resend.dev is Resend's shared sandbox sender and only
    // delivers to the address that owns the Resend account — no customer will
    // ever receive one of these. Verify a real domain in Resend and change this
    // before launch.
    from: "GSC <onboarding@resend.dev>",
    to,
    subject,
    html: body,
  });
}

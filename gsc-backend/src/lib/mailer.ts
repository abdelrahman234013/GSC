import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(to, subject, body) {
  await resend.emails.send({
    from: "GSC <onboarding@resend.dev>",
    to,
    subject,
    html: body,
  });
}

import { sendEmail } from "../lib/mailer";
import { prisma } from "../db";
import { contactMessageAdminEmail } from "../lib/emailTemplates";
import { isValidEmail, isValidEgyptianPhone } from "../lib/validation";

export async function submitContact(req, res) {
  try {
    const { name, email, phone, message } = req.body ?? {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: "name, email, and message are required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    if (phone && !isValidEgyptianPhone(phone)) {
      return res.status(400).json({ error: "phone must be a valid Egyptian number (e.g. 01012345678)" });
    }

    try {
      const admins = await prisma.admin.findMany({ select: { email: true } });
      const msg = contactMessageAdminEmail({ name, email, phone, message });
      await Promise.all(admins.map((a) => sendEmail(a.email, msg.subject, msg.html)));
    } catch (emailErr) {
      console.error("Contact form submitted but admin notification email(s) failed:", emailErr);
    }

    res.json({ message: "Your message has been sent." });
  } catch (err) {
    console.error("POST /contact failed:", err);
    res.status(500).json({ error: "Failed to submit contact message" });
  }
}

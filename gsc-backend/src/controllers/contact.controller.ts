import { contactMessageAdminEmail } from "../lib/emailTemplates";
import { notifyAdmins } from "../lib/notifications";
import { isValidEmail, isValidEgyptianPhone } from "../lib/validation";
import { contactSchema, parseOrFail } from "../lib/schemas";

export async function submitContact(req, res) {
  try {
    const body = parseOrFail(contactSchema, req.body ?? {}, res);
    if (!body) return;
    const { name, email, phone, message } = body;

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    if (phone && !isValidEgyptianPhone(phone)) {
      return res.status(400).json({ error: "phone must be a valid Egyptian number (e.g. 01012345678)" });
    }

    // Handed off to the background so a slow mail provider can't hold this
    // request open. Nothing is persisted by design — the email to the admins is
    // the whole delivery mechanism, so if a send fails the server log line from
    // notifyAdmins is the only trace it happened.
    notifyAdmins(
      contactMessageAdminEmail({ name, email, phone, message }),
      `contact form from ${email}`,
    );

    res.json({ message: "Your message has been sent." });
  } catch (err) {
    console.error("POST /contact failed:", err);
    res.status(500).json({ error: "Failed to submit contact message" });
  }
}

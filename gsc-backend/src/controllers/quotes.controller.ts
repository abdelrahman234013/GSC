import { prisma } from "../db";
import { sendEmail } from "../lib/mailer";
import {
  newQuoteAdminEmail,
  quoteConfirmationEmail,
} from "../lib/emailTemplates";
import { uploadToSupabase } from "../lib/supabaseStorage";

async function generateReferenceNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let referenceNumber;
  do {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    referenceNumber = `RFQ-${datePart}-${suffix}`;
  } while (await prisma.quote.findUnique({ where: { referenceNumber } }));
  return referenceNumber;
}

export async function submitQuote(req, res) {
  try {
    const customerId = req.customer.id; // requireCustomerAuth guarantees this exists

    const {
      springTypeId,
      wireDiameterMm,
      outerDiameterMm,
      innerDiameterMm,
      lengthMm,
      coilCount,
      material,
      quantity,
      notes,
    } = req.body ?? {};

    const quantityNum = Number(quantity);
    if (!Number.isInteger(quantityNum) || quantityNum <= 0) {
      return res
        .status(400)
        .json({ error: "quantity must be a positive integer" });
    }

    if (springTypeId) {
      const type = await prisma.springType.findUnique({
        where: { id: springTypeId },
      });
      if (!type) {
        return res
          .status(400)
          .json({
            error: "springTypeId does not match an existing spring type",
          });
      }
    }

    const address = await prisma.address.findUnique({ where: { customerId } });
    if (!address) {
      return res
        .status(400)
        .json({ error: "Add a contact address before submitting an RFQ" });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { email: true },
    });

    const referenceNumber = await generateReferenceNumber();

    const uploadedFiles = await Promise.all(
      (req.files ?? []).map((f) => uploadToSupabase("quote-files", f)),
    );

    const quote = await prisma.quote.create({
      data: {
        referenceNumber,
        customerId,
        springTypeId: springTypeId || null,
        wireDiameterMm: wireDiameterMm ? Number(wireDiameterMm) : null,
        outerDiameterMm: outerDiameterMm ? Number(outerDiameterMm) : null,
        innerDiameterMm: innerDiameterMm ? Number(innerDiameterMm) : null,
        lengthMm: lengthMm ? Number(lengthMm) : null,
        coilCount: coilCount ? Number(coilCount) : null,
        material: material || null,
        quantity: quantityNum,
        notes: notes || null,
        contactName: address.fullName,
        contactPhone: address.phone,
        contactEmail: customer?.email ?? null,
        files: uploadedFiles.length ? { create: uploadedFiles } : undefined,
      },
      include: { files: true, springType: true },
    });

    try {
      if (quote.contactEmail) {
        const msg = quoteConfirmationEmail(quote);
        await sendEmail(quote.contactEmail, msg.subject, msg.html);
      }
      const admins = await prisma.admin.findMany({ select: { email: true } });
      const adminMsg = newQuoteAdminEmail(quote);
      await Promise.all(
        admins.map((a) => sendEmail(a.email, adminMsg.subject, adminMsg.html)),
      );
    } catch (emailErr) {
      console.error(
        "Quote submitted but notification email(s) failed:",
        emailErr,
      );
    }

    res.status(201).json(quote);
  } catch (err) {
    console.error("POST /quotes failed:", err);
    res.status(500).json({ error: "Failed to submit quote request" });
  }
}

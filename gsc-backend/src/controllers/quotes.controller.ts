import { prisma } from "../db";
import { notifyCustomer, notifyAdmins } from "../lib/notifications";
import {
  newQuoteAdminEmail,
  quoteConfirmationEmail,
} from "../lib/emailTemplates";
import { uploadToSupabase } from "../lib/supabaseStorage";
import { resolveCustomerId, publicQuote } from "../lib/helperFunctions";
import { cleanupStagedFiles } from "../lib/upload";
import { QUOTE_ATTACHMENT_TYPES } from "../lib/fileTypes";
import { quoteSchema, parseOrFail } from "../lib/schemas";
import {
  UploadError,
  signQuoteFiles,
  removeFromSupabase,
} from "../lib/supabaseStorage";

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
    const customerId = resolveCustomerId(req, res);
    if (!customerId) return;

    // Multipart form fields arrive as strings, so the schema coerces numbers.
    const parsed = parseOrFail(quoteSchema, req.body ?? {}, res);
    if (!parsed) return;
    const {
      springTypeId,
      wireDiameterMm,
      outerDiameterMm,
      innerDiameterMm,
      lengthMm,
      coilCount,
      material,
      quantity: quantityNum,
      notes,
    } = parsed;

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
      (req.files ?? []).map((f) =>
        uploadToSupabase("quote-files", f, QUOTE_ATTACHMENT_TYPES),
      ),
    );

    // Files reach storage before this insert, so anything that fails the insert
    // (a validation error, a database blip) would otherwise strand them there
    // with no database row ever referencing them — invisible, and billed for.
    let quote;
    try {
      quote = await prisma.quote.create({
      data: {
        referenceNumber,
        customerId,
        springTypeId: springTypeId || null,
        // Already coerced and range-checked by quoteSchema.
        wireDiameterMm: wireDiameterMm ?? null,
        outerDiameterMm: outerDiameterMm ?? null,
        innerDiameterMm: innerDiameterMm ?? null,
        lengthMm: lengthMm ?? null,
        coilCount: coilCount ?? null,
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
    } catch (createErr) {
      await removeFromSupabase(
        "quote-files",
        uploadedFiles.map((f) => f.url),
      );
      throw createErr;
    }

    // The RFQ is saved; notifications happen after the response goes out.
    notifyCustomer(
      quote.contactEmail,
      quoteConfirmationEmail(quote),
      `quote confirmation ${quote.referenceNumber}`,
    );
    notifyAdmins(
      newQuoteAdminEmail(quote),
      `new RFQ ${quote.referenceNumber}`,
    );

    res.status(201).json({
      ...publicQuote(quote),
      files: await signQuoteFiles(quote.files),
    });
  } catch (err) {
    // A rejected file type is the customer's problem to fix, not a server fault —
    // tell them which file and why instead of a blank 500.
    if (err instanceof UploadError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("POST /quotes failed:", err);
    res.status(500).json({ error: "Failed to submit quote request" });
  } finally {
    // Staged uploads are temp files on disk; they must go whether or not the
    // request succeeded, or the disk fills up over time.
    await cleanupStagedFiles(req);
  }
}

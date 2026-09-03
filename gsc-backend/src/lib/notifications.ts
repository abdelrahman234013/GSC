import { prisma } from "../db";
import { sendEmail } from "./mailer";

// Background notifications — email that must never hold up an HTTP response.
//
// The problem this solves: checkout, RFQ submission, contact and order-status
// updates all used to `await sendEmail(...)` before responding, and fan out with
// Promise.all across every admin in the table. A slow Resend call held the HTTP
// connection open, occupied a Node event-loop slot, and during checkout kept a
// database pool slot too. When the mail provider had a bad minute, the whole site
// had a bad minute — for every visitor, not just the one placing an order.
//
// The important insight is that none of these emails are part of the operation
// succeeding. The order is placed once it is committed to the database; telling
// people about it is a separate concern that can finish later, or fail entirely,
// without changing whether the order exists.
//
// FUTURE: this is the seam where a real job queue goes (BullMQ on Redis, which
// docker-compose.yml already anticipates). A queue adds retries and survives a
// restart — right now a send that fails is logged and gone. Because every caller
// goes through this module, swapping the implementation is a change here only.

/**
 * Runs work after the response has gone out.
 *
 * Nothing awaits the returned promise, so an unhandled rejection here would
 * otherwise crash the process — the .catch() is what makes fire-and-forget safe
 * rather than a latent outage.
 */
function runInBackground(label: string, work: () => Promise<unknown>) {
  void Promise.resolve()
    .then(work)
    .catch((err) => {
      console.error(`[notify] ${label} failed:`, err);
    });
}

/** Emails one recipient without blocking the caller. */
export function notifyCustomer(
  to: string | null | undefined,
  message: { subject: string; html: string },
  label: string,
) {
  if (!to) return;
  runInBackground(`${label} -> ${to}`, () =>
    sendEmail(to, message.subject, message.html),
  );
}

/**
 * Emails every admin without blocking the caller.
 *
 * The admin lookup is deliberately inside the background work: it is a database
 * round-trip, and it was previously on the request path too.
 */
export function notifyAdmins(
  message: { subject: string; html: string },
  label: string,
) {
  runInBackground(`${label} -> admins`, async () => {
    const admins = await prisma.admin.findMany({ select: { email: true } });
    const results = await Promise.allSettled(
      admins.map((a) => sendEmail(a.email, message.subject, message.html)),
    );
    // allSettled, not all: one admin with a bouncing address shouldn't stop the
    // others being notified, and each failure is worth naming individually.
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.error(
          `[notify] ${label} -> ${admins[i]?.email} failed:`,
          result.reason,
        );
      }
    });
  });
}

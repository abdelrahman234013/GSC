const BRAND = {
  navy: "#0B1F3A",
  gold: "#C9A84C",
  fullName: "Global Springs Company",
  tagline: "Reliability Engineered Into Every Coil",
};

/**
 * Escapes a value for interpolation into email HTML.
 *
 * Every value below that came from a user goes through this. Mail clients block
 * scripts, so this is not about XSS — it is about HTML and link injection into a
 * message your staff trust. The contact form is public and unauthenticated, so
 * anyone could previously submit a name of
 *   `Ahmed</p><a href="https://evil.example">Click to view order</a><p>`
 * and have it render as a real link inside an email that appears to come from
 * your own system. That is a clean phishing vector aimed at your own team.
 */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped, but with newlines preserved as line breaks for multi-line input. */
function escMultiline(value: unknown): string {
  return esc(value).replace(/\r?\n/g, "<br>");
}

function wrapEmail(bodyHtml) {
  return `
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f4f4f5; font-family: Arial, Helvetica, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5; padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:8px; overflow:hidden;">
            <tr>
              <td style="background-color:${BRAND.navy}; padding:24px 32px;">
                <span style="color:#ffffff; font-size:20px; font-weight:bold;">${BRAND.fullName}</span><br/>
                <span style="color:${BRAND.gold}; font-size:12px;">${BRAND.tagline}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px; background-color:#f4f4f5; color:#888888; font-size:12px;">
                This is an automated message from ${BRAND.fullName}. If you didn't request this, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(url, label) {
  return `<a href="${esc(url)}" style="display:inline-block; background-color:${BRAND.gold}; color:${BRAND.navy}; text-decoration:none; font-weight:bold; padding:12px 24px; border-radius:4px; margin:16px 0;">${esc(label)}</a>`;
}

export function verificationEmail(link) {
  const bodyHtml = `
    <h2 style="color:${BRAND.navy}; margin-top:0;">Verify your email</h2>
    <p style="color:#333333; font-size:14px; line-height:1.5;">
      Thanks for creating a GSC account. Click the button below to verify your email address and activate your account.
    </p>
    ${button(link, "Verify Email")}
    <p style="color:#888888; font-size:12px; line-height:1.5;">
      This link expires in 24 hours. If the button doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${esc(link)}" style="color:${BRAND.navy};">${esc(link)}</a>
    </p>
  `;
  return { subject: "Verify your GSC account", html: wrapEmail(bodyHtml) };
}

/**
 * Sent when someone tries to register with an address that already has an
 * account.
 *
 * Registration responds identically whether or not the address is taken, so the
 * response itself can no longer be used to discover who has an account. This
 * email is how the real owner finds out — and if it wasn't them, it tells them
 * someone is poking at their address.
 */
export function accountAlreadyExistsEmail(loginLink, resetLink) {
  const bodyHtml = `
    <h2 style="color:${BRAND.navy}; margin-top:0;">You already have an account</h2>
    <p style="color:#333333; font-size:14px; line-height:1.5;">
      Someone just tried to create a GSC account with this email address, but one
      already exists. No new account has been created and nothing has changed.
    </p>
    ${button(loginLink, "Sign In")}
    <p style="color:#888888; font-size:12px; line-height:1.5;">
      Forgotten your password? <a href="${esc(resetLink)}" style="color:${BRAND.navy};">Reset it here</a>.
    </p>
    <p style="color:#888888; font-size:12px; line-height:1.5;">
      If this wasn't you, you can safely ignore this email — your account is unchanged.
    </p>
  `;
  return { subject: "You already have a GSC account", html: wrapEmail(bodyHtml) };
}

export function passwordResetEmail(link) {
  const bodyHtml = `
    <h2 style="color:${BRAND.navy}; margin-top:0;">Reset your password</h2>
    <p style="color:#333333; font-size:14px; line-height:1.5;">
      We received a request to reset the password for your GSC account. Click the button below to choose a new password.
    </p>
    ${button(link, "Reset Password")}
    <p style="color:#888888; font-size:12px; line-height:1.5;">
      This link expires in 15 minutes and can only be used once. If you didn't request a password reset, you can ignore this email — your password won't be changed.
    </p>
    <p style="color:#888888; font-size:12px; line-height:1.5;">
      If the button doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${esc(link)}" style="color:${BRAND.navy};">${esc(link)}</a>
    </p>
  `;
  return { subject: "Reset your GSC password", html: wrapEmail(bodyHtml) };
}

export function orderConfirmationEmail(order) {
  const itemsHtml = order.items
    .map(
      (i) =>
        `<tr><td>${esc(i.nameSnapshotEn)}</td><td>${esc(i.quantity)}</td><td>${esc(i.priceSnapshot)}</td></tr>`,
    )
    .join("");
  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    html: wrapEmail(`
      <p>Thanks for your order! Your order number is <strong>${esc(order.orderNumber)}</strong>.</p>
      <table>${itemsHtml}</table>
      <p>Total: ${esc(order.totalAmount)}</p>
      <p>Payment: Cash on Delivery.</p>
    `),
  };
}

export function newOrderAdminEmail(order) {
  return {
    subject: `New order — ${order.orderNumber}`,
    html: wrapEmail(`
      <p>New order placed: <strong>${esc(order.orderNumber)}</strong></p>
      <p>Customer: ${esc(order.contactName)} — ${esc(order.contactPhone)}</p>
      <p>Total: ${esc(order.totalAmount)}</p>
    `),
  };
}

export function orderStatusUpdateEmail(order) {
  return {
    subject: `Your order ${order.orderNumber} is now ${String(order.status).toLowerCase()}`,
    html: wrapEmail(`
      <p>Your order <strong>${esc(order.orderNumber)}</strong> status has been updated to <strong>${esc(order.status)}</strong>.</p>
    `),
  };
}

export function newQuoteAdminEmail(quote) {
  return {
    subject: `New RFQ — ${quote.referenceNumber}`,
    html: wrapEmail(`
      <p>New custom quote request: <strong>${esc(quote.referenceNumber)}</strong></p>
      <p>Contact: ${esc(quote.contactName)} — ${esc(quote.contactPhone)}</p>
      <p>Quantity: ${esc(quote.quantity)}</p>
    `),
  };
}

export function quoteConfirmationEmail(quote) {
  return {
    subject: `RFQ received — ${quote.referenceNumber}`,
    html: wrapEmail(`
      <p>We've received your custom quote request. Reference number: <strong>${esc(quote.referenceNumber)}</strong>.</p>
      <p>Our team will review the details and get back to you with pricing.</p>
    `),
  };
}

export function contactMessageAdminEmail({ name, email, phone, message }) {
  return {
    subject: `New contact form message from ${name}`,
    html: wrapEmail(`
      <p>New message from the website contact form:</p>
      <p><strong>Name:</strong> ${esc(name)}</p>
      <p><strong>Email:</strong> ${esc(email)}</p>
      ${phone ? `<p><strong>Phone:</strong> ${esc(phone)}</p>` : ""}
      <p><strong>Message:</strong><br>${escMultiline(message)}</p>
    `),
  };
}

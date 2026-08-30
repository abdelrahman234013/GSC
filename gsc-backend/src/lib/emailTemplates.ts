const BRAND = {
  navy: "#0B1F3A",
  gold: "#C9A84C",
  fullName: "Global Springs Company",
  tagline: "Reliability Engineered Into Every Coil",
};

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
  return `<a href="${url}" style="display:inline-block; background-color:${BRAND.gold}; color:${BRAND.navy}; text-decoration:none; font-weight:bold; padding:12px 24px; border-radius:4px; margin:16px 0;">${label}</a>`;
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
      <a href="${link}" style="color:${BRAND.navy};">${link}</a>
    </p>
  `;
  return { subject: "Verify your GSC account", html: wrapEmail(bodyHtml) };
}

export function passwordResetEmail(link) {
  const bodyHtml = `
    <h2 style="color:${BRAND.navy}; margin-top:0;">Reset your password</h2>
    <p style="color:#333333; font-size:14px; line-height:1.5;">
      We received a request to reset the password for your GSC account. Click the button below to choose a new password.
    </p>
    ${button(link, "Reset Password")}
    <p style="color:#888888; font-size:12px; line-height:1.5;">
      This link expires in 15 minutes. If you didn't request a password reset, you can ignore this email — your password won't be changed.
    </p>
    <p style="color:#888888; font-size:12px; line-height:1.5;">
      If the button doesn't work, copy and paste this URL into your browser:<br/>
      <a href="${link}" style="color:${BRAND.navy};">${link}</a>
    </p>
  `;
  return { subject: "Reset your GSC password", html: wrapEmail(bodyHtml) };
}

export function orderConfirmationEmail(order) {
  const itemsHtml = order.items
    .map(
      (i) =>
        `<tr><td>${i.nameSnapshotEn}</td><td>${i.quantity}</td><td>${i.priceSnapshot}</td></tr>`,
    )
    .join("");
  return {
    subject: `Order confirmed — ${order.orderNumber}`,
    html: wrapEmail(`
      <p>Thanks for your order! Your order number is <strong>${order.orderNumber}</strong>.</p>
      <table>${itemsHtml}</table>
      <p>Total: ${order.totalAmount}</p>
      <p>Payment: Cash on Delivery.</p>
    `),
  };
}

export function newOrderAdminEmail(order) {
  return {
    subject: `New order — ${order.orderNumber}`,
    html: wrapEmail(`
      <p>New order placed: <strong>${order.orderNumber}</strong></p>
      <p>Customer: ${order.contactName} — ${order.contactPhone}</p>
      <p>Total: ${order.totalAmount}</p>
    `),
  };
}

export function orderStatusUpdateEmail(order) {
  return {
    subject: `Your order ${order.orderNumber} is now ${order.status.toLowerCase()}`,
    html: wrapEmail(`
      <p>Your order <strong>${order.orderNumber}</strong> status has been updated to <strong>${order.status}</strong>.</p>
    `),
  };
}

export function newQuoteAdminEmail(quote) {
  return {
    subject: `New RFQ — ${quote.referenceNumber}`,
    html: wrapEmail(`
      <p>New custom quote request: <strong>${quote.referenceNumber}</strong></p>
      <p>Contact: ${quote.contactName} — ${quote.contactPhone}</p>
      <p>Quantity: ${quote.quantity}</p>
    `),
  };
}

export function quoteConfirmationEmail(quote) {
  return {
    subject: `RFQ received — ${quote.referenceNumber}`,
    html: wrapEmail(`
      <p>We've received your custom quote request. Reference number: <strong>${quote.referenceNumber}</strong>.</p>
      <p>Our team will review the details and get back to you with pricing.</p>
    `),
  };
}

export function contactMessageAdminEmail({ name, email, phone, message }) {
  return {
    subject: `New contact form message from ${name}`,
    html: wrapEmail(`
      <p>New message from the website contact form:</p>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
      <p><strong>Message:</strong><br>${message}</p>
    `),
  };
}

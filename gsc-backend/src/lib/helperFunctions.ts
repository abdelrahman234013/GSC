export function publicCustomer(customer) {
  const { passwordHash, refreshTokenHash, ...safe } = customer;
  return safe;
}

// Shapes a Quote for the customer who submitted it.
//
// Two fields must not be echoed back as-is:
//   staffNotes  — internal working notes, never customer-facing under any status.
//   quotedPrice — this one IS meant for the customer, but only once staff have
//                 actually issued the quote. While the RFQ is still PENDING the
//                 column may hold a half-finished number someone is working out,
//                 so it stays hidden until the status says the quote is real.
//
// Prefer this over spreading a Quote row straight into a response: listing what
// goes out beats trying to remember everything that has to stay in.
export function publicQuote(quote) {
  const { staffNotes, quotedPrice, ...safe } = quote;
  const quoteIssued = quote.status === "QUOTED" || quote.status === "CLOSED";
  return { ...safe, quotedPrice: quoteIssued ? quotedPrice : null };
}

// Last line of defence for tenant-scoped queries.
//
// Prisma treats `undefined` in a where clause as "this filter was not supplied",
// so `findMany({ where: { customerId: undefined } })` is identical to asking for
// every row in the table. Auth middleware should already guarantee a real id, but
// no handler should hand Prisma an id it has not checked.
//
// Returns the id, or sends a 401 and returns null — call it as:
//   const customerId = resolveCustomerId(req, res);
//   if (!customerId) return;
export function resolveCustomerId(req, res) {
  const id = req.customer?.id;
  if (typeof id !== "string" || id.length === 0) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return id;
}

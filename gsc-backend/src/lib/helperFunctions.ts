export function publicCustomer(customer) {
  const { passwordHash, refreshTokenHash, ...safe } = customer;
  return safe;
}

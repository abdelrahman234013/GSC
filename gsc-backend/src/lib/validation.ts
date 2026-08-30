export function isValidEmail(email) {
  if (typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeEmail(email: any) {
  return email.trim().toLowerCase();
}

export function isValidPassword(password: any) {
  if (typeof password !== "string") return false;
  if (password.length < 8) return false;
  if (!/[0-9]/.test(password)) return false; // at least one number
  if (!/[a-zA-Z]/.test(password)) return false; // at least one letter
  return true;
}

export function isValidEgyptianPhone(phone) {
  return /^(0|\+20|0020)1[0125][0-9]{8}$/.test(phone);
}

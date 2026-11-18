import bcrypt from "bcryptjs";

const ROUNDS = 12;

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 12) return "Şifre en az 12 karakter olmalı";
  if (!/[a-zçğıöşü]/.test(pw) || !/[A-ZÇĞİÖŞÜ]/.test(pw) || !/\d/.test(pw)) return "Şifre büyük harf, küçük harf ve rakam içermeli";
  if (/^(password|admin|changeme|123456)/i.test(pw)) return "Şifre çok yaygın";
  return null;
}

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, ROUNDS);
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

import bcrypt from "bcryptjs";

const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);

export function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function comparePassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// Real authentication helpers - passwords are never stored in plaintext.
// Uses Node's built-in crypto (scrypt) so no extra dependency is needed.

const crypto = require("crypto");

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, useSalt, 64).toString("hex");
  return { salt: useSalt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(check, "hex"), Buffer.from(hash, "hex"));
  } catch (e) {
    return false;
  }
}

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

module.exports = { hashPassword, verifyPassword, generateToken };

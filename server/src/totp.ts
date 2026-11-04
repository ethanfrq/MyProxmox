// Codes à usage unique basés sur le temps (TOTP, RFC 6238), sans dépendance externe.
// Compatible avec Google Authenticator, Aegis, 2FAS, Bitwarden...
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nouveau secret de 160 bits, en base32. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** Code à 6 chiffres pour un pas de temps donné (30 s). */
export function hotp(secret: string, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

export const totpNow = (secret: string, at = Date.now()) => hotp(secret, Math.floor(at / 30000));

/** Vérifie un code en tolérant un pas de décalage (horloge du téléphone). */
export function verifyTotp(secret: string, code: string, at = Date.now()) {
  const c = String(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(at / 30000);
  for (const d of [-1, 0, 1]) {
    const expected = Buffer.from(hotp(secret, step + d));
    if (timingSafeEqual(expected, Buffer.from(c))) return true;
  }
  return false;
}

export function otpauthUri(secret: string, account: string, issuer = "MyProxmox") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

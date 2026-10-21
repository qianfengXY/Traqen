// Shared by extraction, immutable publication validation and current display.
// Retain compact legacy credential spellings (DBPASSWORD, APITOKEN), while
// excluding the established non-credential tokens/tokenizer vocabulary.
export function isSensitiveKey(value) {
  if (typeof value !== "string") return false;
  if (/(?:password|secret|passphrase|credential|(?:api|private|access)[_-]?key)/i.test(value)) return true;
  const words = value.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some(word => word.includes("token") && !word.includes("tokens") && !word.includes("tokenizer"))
    || words.some((word, index) => ["api", "private", "access"].includes(word) && words[index + 1] === "key");
}

export function containsPrivateKey(value) {
  if (typeof value !== "string") return false;
  // Check encoded source spellings as well as decoded scalar values. Never
  // evaluate source, interpolate a value, or expose the matched key material.
  const spelling = value.replace(/\\(?:u([a-f\d]{4})|x([a-f\d]{2}))/gi,
    (_match, unicode, hex) => String.fromCharCode(parseInt(unicode ?? hex, 16)));
  return /-----\s*(?:BEGIN|END)\s+(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED)\s+)?PRIVATE KEY\s*-----|-----\s*(?:BEGIN|END)\s+PGP PRIVATE KEY BLOCK\s*-----/i.test(spelling);
}

export const isRestrictedText = value => isSensitiveKey(value) || containsPrivateKey(value);

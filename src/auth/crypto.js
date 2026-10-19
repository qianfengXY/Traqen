import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { AuthError } from "./errors.js";
const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString("base64url");
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export function equal(left, right) {
  const a = Buffer.from(String(left)),
    b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
// Bound the expensive operation across every service instance, including unknown users.
let active = 0;
const queue = [];
async function passwordKey(password, salt) {
  if (active >= 2) {
    if (queue.length >= 16) throw new AuthError(429, "AUTH_BUSY", "登录繁忙，请稍后再试");
    await new Promise((resolve) => queue.push(resolve));
  } else active++;
  try {
    return await derive(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
export function assertPassword(password) {
  if (typeof password !== "string" || [...password].length < 8 || Buffer.byteLength(password) > 1024)
    throw new TypeError("密码至少 8 个字符，最多 1024 字节");
}
export async function hashPassword(password) {
  assertPassword(password);
  const salt = randomBytes(16).toString("hex");
  const hash = await passwordKey(password, Buffer.from(salt, "hex"));
  return { algorithm: "scrypt-v1", N: 131072, r: 8, p: 1, salt, hash: hash.toString("hex") };
}
export async function verifyPassword(password, record) {
  if (typeof password !== "string" || Buffer.byteLength(password) > 1024) return false;
  if (record?.algorithm !== "scrypt-v1" || !/^[a-f0-9]{32}$/.test(record.salt) || !/^[a-f0-9]{128}$/.test(record.hash))
    return false;
  return equal((await passwordKey(password, Buffer.from(record.salt, "hex"))).toString("hex"), record.hash);
}
const routeKeys = new Set([
  "page",
  "workspace",
  "sourceBundle",
  "sourceReceipt",
  "sourceComponent",
  "view",
  "workspaceId",
  "version",
  "revision",
  "objectId",
  "entry",
  "receiptId",
  "bundleId",
  "sourceId",
  "runId",
  "applicationId",
]);
export function safeDestination(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return "/";
  try {
    const url = new URL(value, "https://traqen.invalid");
    if (
      url.origin !== "https://traqen.invalid" ||
      url.pathname !== "/" ||
      [...url.searchParams.keys()].some((key) => !routeKeys.has(key))
    )
      return "/";
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

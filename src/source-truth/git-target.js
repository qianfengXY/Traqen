import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { requireValue, SourceTruthError } from "./errors.js";

const privateNetworks = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) privateNetworks.addSubnet(address, prefix, "ipv4");
// IPv6 uses a positive global-unicast boundary as well as exclusions. This
// rejects mapped/compatible IPv4, NAT64, multicast and transition addresses.
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
  ["3fff::", 20]]) privateNetworks.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

function permittedAddress(address, exceptions) {
  const family = isIP(address);
  if (!family || address.includes("%")) return false;
  if (exceptions?.includes(address)) return true;
  return family === 4 ? !privateNetworks.check(address, "ipv4")
    : globalV6.check(address, "ipv6") && !privateNetworks.check(address, "ipv6");
}

function blocked(condition) {
  requireValue(condition, "SOURCE_GIT_TARGET_BLOCKED", "Git 来源必须是平台授权的 HTTPS 目标，且实际连接地址在许可边界内", { status: 400 });
}

export async function resolveGitTarget(rawUrl, targets, lookup = dnsLookup) {
  blocked(typeof rawUrl === "string" && rawUrl.length <= 2048 && !/[\u0000-\u0020\u007f\\]/u.test(rawUrl));
  let url;
  try { url = new URL(rawUrl); } catch { blocked(false); }
  blocked(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash);
  const target = targets?.find((item) => item.origin === url.origin);
  blocked(target);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let answers;
  try {
    answers = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw new SourceTruthError("SOURCE_GIT_DNS_UNAVAILABLE", "无法解析已授权 Git 目标，请重试或检查来源配置", { status: 503, cause });
  }
  blocked(Array.isArray(answers) && answers.length > 0 && answers.length <= 64
    && answers.every(({ address }) => permittedAddress(address, target.allowedAddresses)));
  const address = answers[0].address;
  const port = url.port || "443";
  return {
    url: url.href, origin: url.origin, hostname, port, address, family: isIP(address),
    // This must accompany EVERY network Git operation, not just preflight.
    curlResolve: `${hostname}:${port}:${isIP(address) === 6 ? `[${address}]` : address}`,
    caFile: target.caFile ?? null,
  };
}

export function validateGitRef(ref) {
  requireValue(typeof ref === "string" && ref.length > 0 && ref.length <= 1024
    && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) && !ref.includes("..")
    && ref.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock")),
  "SOURCE_GIT_REF_INVALID", "请选择明确的 branch、tag 或完整 commit，不支持版本表达式", { status: 400 });
  return ref;
}

import { createHash, createPublicKey, verify } from "node:crypto";
import { canonicalEncode } from "../source-truth/identity.js";
import { privateSourceFile } from "../source-truth/configuration.js";
import { requireF003 } from "./errors.js";
import { selectGraphQualityPolicy } from "./quality-contract-adapter.js";

export const publicationDigest = value => createHash("sha256").update(canonicalEncode(value)).digest("hex");

// The trust root and approved report paths belong to deployment administration.
// There is intentionally no HTTP endpoint accepting a key, report path, approval
// boolean or reviewer identity. Reports are assertions by configured independent
// signers, not model results or a replacement for the actual backup verifier.
export class PublicationAuthority {
  constructor({ issuers = [], artifactFiles = [], implementationAuthors = [], qualityPolicy = null } = {}) {
    requireF003(Array.isArray(issuers) && Array.isArray(artifactFiles) && Array.isArray(implementationAuthors)
      && issuers.length <= 32 && artifactFiles.length <= 32 && implementationAuthors.length <= 100
      && implementationAuthors.every(id => typeof id === "string" && id.trim().length > 0),
    "F003_AUTHORITY_INVALID", "发布证据配置或实现作者身份无效", { status: 503 });
    this.authors = new Set(implementationAuthors); this.issuers = new Map();
    for (const issuer of issuers) {
      requireF003(typeof issuer.id === "string" && issuer.id.trim().length>0 && !this.issuers.has(issuer.id) && ["QUALITY", "RECOVERY", "CALIBRATION"].includes(issuer.kind)
        && (issuer.kind === "RECOVERY" || (this.authors.size > 0 && !this.authors.has(issuer.id))),
      "F003_AUTHORITY_INVALID", "需要获准且独立的证据签发身份", { status: 503 });
      let publicKey;
      try { publicKey = createPublicKey(issuer.publicKey); } catch { /* fail closed below */ }
      requireF003(publicKey?.asymmetricKeyType === "ed25519", "F003_AUTHORITY_INVALID", "证据须固定有效的 Ed25519 公钥", { status: 503 });
      this.issuers.set(issuer.id, { ...issuer, publicKey });
    }
    this.artifactFiles = [...artifactFiles];
    this.qualityPolicy = selectGraphQualityPolicy(qualityPolicy);
    if(this.qualityPolicy) {
      const s=this.qualityPolicy.scope,evaluator=this.issuers.get(s.evaluatorIssuerId),calibrator=this.issuers.get(s.calibratorIssuerId);
      requireF003(evaluator?.kind==='QUALITY' && calibrator?.kind==='CALIBRATION'
        && !evaluator.publicKey.equals(calibrator.publicKey)
        && [...this.issuers.values()].filter(i=>this.authors.has(i.id)).every(i=>
          !i.publicKey.equals(evaluator.publicKey) && !i.publicKey.equals(calibrator.publicKey)),
      'F003_AUTHORITY_INVALID','计量与校准需要用途匹配、非作者且不同公钥的部署签发者',{status:503});
    }
  }
  #verify(document, binding, purposes) {
    const p = document?.payload, issuer = this.issuers.get(document?.issuerId);
    requireF003(issuer && purposes.includes(issuer.kind) && p?.version === 1 && p.kind === issuer.kind && p.issuerId === document.issuerId
      && p.evidenceClass === (issuer.kind==='CALIBRATION'?'INDEPENDENT_REFERENCE_CALIBRATION':"REAL_PROJECT")
      && canonicalEncode(p.binding) === canonicalEncode(binding)
      && Number.isFinite(Date.parse(p.observedAt)) && Date.parse(p.observedAt)<=Date.now()
      && (!p.validUntil || Date.parse(p.validUntil) > Date.now())
      && typeof document.signature === "string" && /^[A-Za-z0-9_-]{86}$/.test(document.signature),
    "F003_EVIDENCE_UNTRUSTED", "证据身份、种类、绑定或有效期不可核验");
    requireF003(verify(null, Buffer.from(canonicalEncode(p)), issuer.publicKey, Buffer.from(document.signature, "base64url")),
      "F003_EVIDENCE_UNTRUSTED", "证据签名不可核验");
    return { id: publicationDigest(document), kind: p.kind, issuerId: issuer.id, bindingDigest: publicationDigest(binding), document: structuredClone(document) };
  }
  verify(document,binding) {return this.#verify(document,binding,['QUALITY','RECOVERY']);}
  verifyCalibration(document,binding) {return this.#verify(document,binding,['CALIBRATION']);}
  async read(binding) {
    const records = [], diagnostics = [];
    for (const filename of this.artifactFiles) {
      try {
        const file = await privateSourceFile(filename), pack = JSON.parse(file.bytes.toString("utf8"));
        requireF003(Array.isArray(pack.artifacts) && pack.artifacts.length <= 100, "F003_EVIDENCE_UNTRUSTED", "证据文件必须为有界签名集合");
        for (const document of pack.artifacts) {
          if(!['QUALITY','RECOVERY'].includes(document?.payload?.kind))continue;
          // Other run-bound records remain in the approved file but do not
          // authorize this run. No private report body is returned to clients.
          if (publicationDigest(document?.payload?.binding ?? null) !== publicationDigest(binding)) continue;
          try { records.push(this.verify(document, binding)); } catch { diagnostics.push({ code: "F003_EVIDENCE_UNTRUSTED" }); }
        }
      } catch { diagnostics.push({ code: "F003_EVIDENCE_UNAVAILABLE" }); }
    }
    return { records, diagnostics };
  }
}

export async function loadPublicationAuthority(filename = null) {
  if (!filename) return new PublicationAuthority();
  try {
    const file = await privateSourceFile(filename), config = JSON.parse(file.bytes.toString("utf8"));
    requireF003(config.version === 1 && Object.keys(config).every(k => ["version", "issuers", "artifactFiles", "implementationAuthors", "qualityPolicy"].includes(k)),
      "F003_AUTHORITY_INVALID", "发布证据配置版本或字段无效", { status: 503 });
    return new PublicationAuthority(config);
  } catch { requireF003(false, "F003_AUTHORITY_INVALID", "无法核验服务端发布证据配置", { status: 503 }); }
}

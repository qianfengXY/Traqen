> Language: **English** · [简体中文](README.zh-CN.md)

# Documentation

Traqen maintains its product and engineering documentation in English and Simplified Chinese. Both versions describe the same product intent, constraints, implementation state, and operating guidance.

## Documentation map

- [Architecture and product design](architecture/enterprise-traceable-quality-platform-design-v0.2.en.md) · [中文原文](architecture/enterprise-traceable-quality-platform-design-v0.2.md)
- [Implementation validation records](implementation/)
- [Project overview and operating guide](../README.md) · [简体中文](../README.zh-CN.md)

## Bilingual documentation policy

Every pull request that adds or changes documentation must add or update both language versions in the same change.

- Prefer an English canonical filename such as `guide.md` with a Simplified Chinese counterpart named `guide.zh-CN.md`.
- When an existing Chinese document owns a stable canonical path, retain that path and add an English counterpart named `guide.en.md`. The architecture design currently follows this compatibility rule.
- Every pair must begin with a language switch linking to the other version.
- Keep code, commands, API paths, identifiers, enum values, configuration keys, and product model names unchanged unless the document explicitly explains a localized label.
- Product vision, guardrails, security boundaries, acceptance status, and known limitations must have equivalent meaning in both versions. A translation must not weaken or expand a requirement.
- Update both versions together. If one version cannot be updated accurately, do not merge the documentation change.

The automated test `test/bilingual-documentation.test.js` enforces file pairing and language-switch links for Markdown files under `docs/` and for repository README files.

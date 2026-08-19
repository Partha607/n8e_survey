/**
 * License allowlist gate (CLAUDE.md rule 1): only MIT / Apache-2.0 / BSD / ISC.
 * Cross-platform Node script; CI fails on any violation.
 *
 * Package-scoped exemptions are listed openly below — each requires a
 * DECISIONS.md entry. They are per-package, never per-license, so a new
 * dependency can't ride in under an exempted license.
 */
import { execSync } from "node:child_process";

const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "ISC",
  "PostgreSQL", // BSD-equivalent, OSI-approved (pg ecosystem)
]);

// package → allowed license, with the justifying DECISIONS.md entry date
const PACKAGE_EXEMPTIONS = new Map([
  // browser-support data file used by every browserslist toolchain (Next,
  // Tailwind). Attribution-only data license; DECISIONS.md 2026-08-19.
  ["caniuse-lite", "CC-BY-4.0"],
]);

// Build/test tooling only (never shipped in the product): additional
// permissive, non-viral licenses that the mandated toolchain drags in
// (Tailwind 4 → lightningcss MPL-2.0; axe is MPL-2.0 and required by the
// a11y gate). File-level or attribution licenses — no obligation on our code
// when used unmodified. DECISIONS.md 2026-08-19. GPL/AGPL/LGPL fail anywhere.
const TOOLING_ONLY_ALLOWED = new Set([
  "MPL-2.0",
  "Python-2.0",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
]);

function scan(scopeArgs, extraAllowed) {
  const raw = execSync(`pnpm licenses list --json ${scopeArgs}`, { encoding: "utf8" });
  const byLicense = JSON.parse(raw);
  const violations = [];
  for (const [license, packages] of Object.entries(byLicense)) {
    // pnpm may report compound expressions like "(MIT OR Apache-2.0)"
    const expr = license.replace(/[()]/g, "");
    const alternatives = expr.split(/\s+OR\s+/i).map((l) => l.trim());
    if (alternatives.some((l) => ALLOWED.has(l) || extraAllowed.has(l))) continue;
    for (const pkg of packages) {
      if (PACKAGE_EXEMPTIONS.get(pkg.name) === license) continue;
      violations.push(`${pkg.name}@${(pkg.versions ?? []).join(",")} — ${license}`);
    }
  }
  return violations;
}

// 1) Product tree (what ships): strict allowlist + named exemptions only.
const prodViolations = scan("--prod", new Set());
// 2) Full tree (incl. dev tooling): allowlist + bounded tooling licenses.
const devViolations = scan("", TOOLING_ONLY_ALLOWED);

const violations = [...prodViolations, ...devViolations];
if (violations.length) {
  console.error("License allowlist violations:");
  for (const v of violations) console.error("  " + v);
  process.exit(1);
}
console.log(
  "License check passed: product deps MIT/Apache-2.0/BSD/ISC; tooling within the documented permissive set (DECISIONS.md).",
);

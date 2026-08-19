/**
 * Scopes (N8E-API-SPEC §4.5): `<product>:<capability>`. Route handlers declare
 * a required scope; enforcement is pipeline, not per-handler code.
 */
export const SCOPES = [
  "collect:read",
  "collect:write",
  "collect:respond", // implicit respondent plane
  "core:files",
  "core:audit:read",
] as const;

export type Scope = (typeof SCOPES)[number];

export type Identity =
  | { plane: "session"; adminId: string; email: string }
  | { plane: "respondent" }
  | { plane: "anonymous" };

/** Admin session ⇒ all collect:* + core:*; respondent plane holds collect:respond. */
export function identityHasScope(identity: Identity, scope: Scope): boolean {
  switch (identity.plane) {
    case "session":
      return true;
    case "respondent":
      return scope === "collect:respond";
    case "anonymous":
      return false;
  }
}

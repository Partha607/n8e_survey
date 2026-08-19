/**
 * `pnpm api:openapi` — builds openapi.json from the route files themselves
 * (N8E-API-SPEC §5.5): the same Zod schemas that validate requests generate
 * the document, so contract and implementation cannot drift.
 *
 * Cross-platform Node script; imports TS route modules via tsx.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const API_ROOT = path.resolve("src/app/api");
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

function findRouteFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function urlPath(file) {
  const rel = path.relative(API_ROOT, path.dirname(file)).split(path.sep).join("/");
  return (
    "/api/" +
    rel
      .split("/")
      .map((seg) =>
        seg.startsWith("[") && seg.endsWith("]") ? `{${seg.slice(1, -1)}}` : seg,
      )
      .join("/")
  );
}

function schemaToJson(schema) {
  if (!schema) return undefined;
  try {
    return z.toJSONSchema(schema, { io: "input", target: "draft-7" });
  } catch {
    return { description: "unrepresentable schema" };
  }
}

const paths = {};
for (const file of findRouteFiles(API_ROOT)) {
  const mod = await import(pathToFileURL(file).href);
  const route = urlPath(file);
  for (const method of METHODS) {
    const handler = mod[method];
    if (!handler?.apiDef) continue;
    const def = handler.apiDef;
    const op = {
      summary: def.summary ?? "",
      "x-n8e-scope": def.scope ?? null,
      "x-n8e-plane": def.plane,
      parameters: [],
      responses: {
        200: {
          description: "Success envelope { data, meta }",
        },
        default: {
          description:
            "Error envelope { error: { code, message, fieldErrors?, requestId } }",
        },
      },
    };
    const paramsJson = schemaToJson(def.params);
    if (paramsJson?.properties) {
      for (const [name, propSchema] of Object.entries(paramsJson.properties)) {
        op.parameters.push({ name, in: "path", required: true, schema: propSchema });
      }
    }
    const queryJson = schemaToJson(def.query);
    if (queryJson?.properties) {
      for (const [name, propSchema] of Object.entries(queryJson.properties)) {
        op.parameters.push({
          name,
          in: "query",
          required: (queryJson.required ?? []).includes(name),
          schema: propSchema,
        });
      }
    }
    const bodyJson = schemaToJson(def.body);
    if (bodyJson) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: bodyJson } },
      };
    }
    paths[route] ??= {};
    paths[route][method.toLowerCase()] = op;
  }
}

const doc = {
  openapi: "3.1.0",
  info: {
    title: "N8E API",
    version: "1.0.0",
    description:
      "N8E Labs' application contract. Product-first versioned namespaces: /api/collect/v1 (Collect), /api/core/v1 (shared platform).",
  },
  paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
};

writeFileSync("openapi.json", JSON.stringify(doc, null, 2) + "\n");
console.log(
  `openapi.json written: ${Object.keys(paths).length} paths, ${Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0)} operations`,
);

import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pnpm-workspace.yaml (used only for build-script approval) would otherwise
  // make file tracing treat this as a monorepo and mis-root standalone output
  outputFileTracingRoot: path.join(__dirname),
  // pnpm tracing gap: @swc/helpers' esm/ dir is resolved at runtime by Next's
  // require-hook but not traced — without this the standalone server crashes
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**"],
  },
};

export default nextConfig;

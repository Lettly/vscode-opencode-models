import { build } from "esbuild"

const watch = process.argv.includes("--watch")
const options = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
}

if (watch) {
  const { context } = await import("esbuild")
  const ctx = await context(options)
  await ctx.watch()
} else {
  await build(options)
}

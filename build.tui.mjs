import esbuild from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const watch = process.argv.includes("--watch")

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/tui.tsx"],
  outfile: "dist/tui.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "esnext",
  jsx: "automatic",
  jsxImportSource: "@opentui/solid",
  external: [
    "@opencode/plugin",
    "@opencode/plugin/tui",
    "solid-js",
    "solid-js/store",
    "@opentui/core",
    "@opentui/solid",
  ],
  plugins: [solidPlugin({ solid: { generate: "universal", moduleName: "@opentui/solid" } })],
  logLevel: "info",
}

if (watch) {
  const context = await esbuild.context(options)
  await context.watch()
  console.log("watching src/ → dist/tui.js (run /reload in the TUI after each rebuild)")
} else {
  await esbuild.build(options)
}

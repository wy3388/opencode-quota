import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Options } from "./types"

/** Resolve OpenCode's data directory the same way the server does. */
export function dataDirectory(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim()
  if (xdg) return join(xdg, "opencode")
  return join(process.env.HOME?.trim() || homedir(), ".local", "share", "opencode")
}

/**
 * Ollama Cloud needs a bearer token for /api/balance. The key may live in the
 * server process only, so try the common locations in order:
 * env, plugin option, then the server's stored credentials.
 *
 * The value is never logged, echoed, or included in errors.
 */
export async function resolveOllamaKey(options: Options): Promise<string | undefined> {
  const fromEnv = process.env.OLLAMA_API_KEY?.trim()
  if (fromEnv) return fromEnv

  const fromOptions = typeof options.ollamaKey === "string" ? options.ollamaKey.trim() : ""
  if (fromOptions) return fromOptions

  return readStoredKey("ollama")
}

async function readStoredKey(providerID: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(dataDirectory(), "auth.json"), "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return undefined
    const record = parsed as Record<string, { type?: string; key?: string } | undefined>
    const key = record[providerID]?.key
    if (typeof key !== "string") return undefined
    const trimmed = key.trim()
    return trimmed.length > 0 ? trimmed : undefined
  } catch {
    return undefined
  }
}

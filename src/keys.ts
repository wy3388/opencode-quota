import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin/tui"
import type { Options } from "./types"

type Context = Plugin.Context

/** Resolve OpenCode's data directory the same way the server does. */
export function dataDirectory(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim()
  if (xdg) return join(xdg, "opencode")
  return join(process.env.HOME?.trim() || homedir(), ".local", "share", "opencode")
}

/**
 * Ollama Cloud needs a bearer token for /api/balance. Only the server knows
 * every place a credential can live, so ask it first; env and plugin options
 * stay as explicit overrides.
 *
 * The value is never logged, echoed, or included in errors.
 */
export async function resolveOllamaKey(
  context: Context,
  providerID: string,
  options: Options,
): Promise<string | undefined> {
  const fromOptions = typeof options.ollamaKey === "string" ? options.ollamaKey.trim() : ""
  if (fromOptions) return fromOptions

  const fromEnv = process.env.OLLAMA_API_KEY?.trim()
  if (fromEnv) return fromEnv

  const fromIntegration = await readIntegrationKey(context, providerID)
  if (fromIntegration) return fromIntegration

  return readStoredKey(providerID)
}

/**
 * Integration providers (such as ollama-cloud) keep their credential in the
 * server's credential store rather than auth.json.
 */
async function readIntegrationKey(context: Context, providerID: string): Promise<string | undefined> {
  try {
    const providers = context.data.location.provider.list(context.location) ?? []
    const provider = providers.find((entry) => entry.id === providerID)
    const integrationID = provider?.integrationID ?? providerID

    const credentials = await context.client.credential.list()
    const candidates = credentials.filter(
      (entry) =>
        entry.active !== false &&
        (entry.integrationID === integrationID || entry.integrationID === providerID),
    )

    for (const entry of candidates) {
      const value = entry.value as { type?: string; key?: string; access?: string }
      const secret = value.type === "key" ? value.key : value.type === "oauth" ? value.access : undefined
      const trimmed = secret?.trim()
      if (trimmed) return trimmed
    }
    return undefined
  } catch {
    return undefined
  }
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

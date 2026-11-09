import type { Adapter, Options, Snapshot } from "./types"
import { QuotaError } from "./errors"
import { resolveOllamaKey } from "./keys"

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/** OpenCode Go: the server already holds the Console session, so no key handling here. */
export const goAdapter: Adapter = {
  id: "opencode-go",
  label: "Go",
  async fetch(ctx, signal) {
    const location = ctx.location ?? ctx.data.location.default()
    const response = await ctx.client.experimental.usage.limits({ location })
    if (signal.aborted) throw new QuotaError("aborted")

    const info = response.data
    if (!info) return { kind: "notice", text: "未登录 Console" }
    if (!info.go) return { kind: "notice", text: "工作区未开通 Go" }

    return {
      kind: "go",
      rolling: info.go.rolling,
      weekly: info.go.weekly,
      monthly: info.go.monthly,
      usageURL: info.workspace.usageURL,
    }
  },
}

/** Ollama Cloud: third-party balance endpoint, needs the account's API key. */
export const ollamaAdapter: Adapter = {
  id: "ollama",
  label: "Ollama",
  async fetch(ctx, signal, options: Options, providerID: string): Promise<Snapshot> {
    const key = await resolveOllamaKey(ctx, providerID, options)
    if (!key) return { kind: "notice", text: "未配置 key" }

    const base = (options.ollamaBaseURL ?? "https://ollama.com").replace(/\/+$/, "")
    const response = await fetch(`${base}/api/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
    })

    if (response.status === 401 || response.status === 403) return { kind: "notice", text: "key 无效" }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "")
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60
      throw new QuotaError("限流", seconds * 1000)
    }
    if (!response.ok) throw new QuotaError(String(response.status))

    const body = (await response.json()) as Record<string, any>
    const included = body?.included ?? {}
    const purchased = body?.purchased ?? {}

    const snapshot: Extract<Snapshot, { kind: "ollama" }> = {
      kind: "ollama",
      remaining: number(included.balance_usd),
      allowance: number(included.allowance_usd),
      purchased: number(purchased.balance_usd),
      resetAt: typeof included.period?.until === "string" ? Date.parse(included.period.until) || undefined : undefined,
      session: number(included.session?.remaining_percent),
      weekly: number(included.weekly?.remaining_percent),
    }

    if (
      snapshot.remaining === undefined &&
      snapshot.allowance === undefined &&
      snapshot.session === undefined &&
      snapshot.weekly === undefined
    ) {
      return { kind: "notice", text: "无余额数据" }
    }
    return snapshot
  },
}

export const adapters: readonly Adapter[] = [goAdapter, ollamaAdapter]

export function adapterFor(providerID: string | undefined, options: Options): Adapter | undefined {
  if (!providerID) return undefined
  const id = providerID.toLowerCase()
  return adapters.find((adapter) => {
    if (adapter.id === "opencode-go") return options.go !== false && id === adapter.id
    if (adapter.id === "ollama") return options.ollama !== false && (id === adapter.id || id.startsWith("ollama-"))
    return false
  })
}

import type { Adapter, Options, Snapshot } from "./types"
import { QuotaError } from "./errors"
import { resolveProviderKey } from "./keys"

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const decimal = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const retryAfter = (response: Response): never => {
  const header = Number(response.headers.get("retry-after") ?? "")
  const seconds = Number.isFinite(header) && header > 0 ? header : 60
  throw new QuotaError("限流", seconds * 1000)
}

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
    const key = await resolveProviderKey(ctx, providerID, { option: options.ollamaKey, env: "OLLAMA_API_KEY" })
    if (!key) return { kind: "notice", text: "未配置 key" }

    const base = (options.ollamaBaseURL ?? "https://ollama.com").replace(/\/+$/, "")
    const response = await fetch(`${base}/api/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
    })

    if (response.status === 401 || response.status === 403) return { kind: "notice", text: "key 无效" }
    if (response.status === 429) retryAfter(response)
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

/** DeepSeek official API: prepaid balance per currency. */
export const deepseekAdapter: Adapter = {
  id: "deepseek",
  label: "DeepSeek",
  async fetch(ctx, signal, options: Options, providerID: string): Promise<Snapshot> {
    const key = await resolveProviderKey(ctx, providerID, { option: options.deepseekKey, env: "DEEPSEEK_API_KEY" })
    if (!key) return { kind: "notice", text: "未配置 key" }

    const base = (options.deepseekBaseURL ?? "https://api.deepseek.com").replace(/\/+$/, "")
    const response = await fetch(`${base}/user/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
    })

    if (response.status === 401 || response.status === 403) return { kind: "notice", text: "key 无效" }
    if (response.status === 429) retryAfter(response)
    if (!response.ok) throw new QuotaError(String(response.status))

    const body = (await response.json()) as Record<string, any>
    const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : []
    const balances = infos.flatMap((info: any) => {
      const currency = typeof info?.currency === "string" ? info.currency : undefined
      const total = decimal(info?.total_balance)
      if (!currency || total === undefined) return []
      return [
        {
          currency,
          total,
          granted: decimal(info?.granted_balance),
          toppedUp: decimal(info?.topped_up_balance),
        },
      ]
    })

    if (balances.length === 0) return { kind: "notice", text: "无余额数据" }
    return { kind: "deepseek", available: body?.is_available !== false, balances }
  },
}

export const adapters: readonly Adapter[] = [goAdapter, ollamaAdapter, deepseekAdapter]

export function adapterFor(providerID: string | undefined, options: Options): Adapter | undefined {
  if (!providerID) return undefined
  const id = providerID.toLowerCase()
  return adapters.find((adapter) => {
    if (adapter.id === "opencode-go") return options.go !== false && id === adapter.id
    if (adapter.id === "ollama") return options.ollama !== false && (id === adapter.id || id.startsWith("ollama-"))
    if (adapter.id === "deepseek") return options.deepseek !== false && (id === adapter.id || id.startsWith("deepseek-"))
    return false
  })
}

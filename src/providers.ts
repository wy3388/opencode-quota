import type { Plugin } from "@opencode/plugin/tui"
import type { Adapter, Meter, Options, Snapshot } from "./types"
import { QuotaError } from "./errors"
import { resolveProviderKey } from "./keys"

type Context = Plugin.Context

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

const isoTime = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string") return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** `status: "ok"` means the window still has room; anything else counts as reached. */
const goMeter = (value: any): Meter | undefined => {
  const percent = number(value?.percent)
  const resetsAt = isoTime(value?.resetsAt)
  if (percent === undefined || resetsAt === undefined) return undefined
  const limited = typeof value?.status === "string" ? value.status !== "ok" : percent >= 100
  return { percent, limited, resetsAt }
}

const GO_USAGE_FALLBACK = "https://opencode.ai/zen/go/v1"
const GO_CONSOLE_URL = "https://opencode.ai/console/go"

/**
 * The Go usage endpoint lives next to the provider's inference base URL, but
 * never under the `/openai` compatibility prefix:
 *   https://opencode.ai/inference/go/openai/v1 -> https://opencode.ai/inference/go/v1/usage
 *   https://opencode.ai/zen/go/v1              -> https://opencode.ai/zen/go/v1/usage
 */
function goUsageEndpoint(base: string): string {
  const trimmed = base
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/openai\/v1$/, "/v1")
    .replace(/\/openai$/, "")
  return `${trimmed}/usage`
}

/** Read the configured inference base URL from the server's provider list. */
function providerBaseURL(ctx: Context, providerID: string): string | undefined {
  try {
    const providers = ctx.data.location.provider.list(ctx.location) ?? []
    const base = providers.find((entry) => entry.id === providerID)?.settings?.baseURL
    return typeof base === "string" && base.trim() ? base.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Go can be configured two ways: a Console login (server holds the session)
 * or an API key pasted through `/connect`. The latter has no workspace on the
 * server, so `experimental.usage.limits` returns null; the same percentages
 * are then available from the inference API with the key itself.
 */
async function goUsageFromKey(
  ctx: Context,
  signal: AbortSignal,
  options: Options,
  providerID: string,
): Promise<Snapshot | undefined> {
  const key = await resolveProviderKey(ctx, providerID, { option: options.goKey, env: "OPENCODE_API_KEY" })
  if (!key) return undefined

  const base = options.goBaseURL ?? providerBaseURL(ctx, providerID) ?? GO_USAGE_FALLBACK
  const response = await fetch(goUsageEndpoint(base), {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal,
  })

  if (response.status === 401 || response.status === 403) return { kind: "notice", text: "key 无效" }
  if (response.status === 429) retryAfter(response)
  if (!response.ok) throw new QuotaError(String(response.status))

  const body = (await response.json()) as Record<string, any>
  const usage = body?.usage ?? body
  const rolling = goMeter(usage?.rolling)
  const weekly = goMeter(usage?.weekly)
  const monthly = goMeter(usage?.monthly)
  if (!rolling || !weekly || !monthly) return { kind: "notice", text: "无用量数据" }

  return { kind: "go", rolling, weekly, monthly, usageURL: options.goUsageURL ?? GO_CONSOLE_URL }
}

/** OpenCode Go: prefer the server's Console session, fall back to the API key. */
export const goAdapter: Adapter = {
  id: "opencode-go",
  label: "Go",
  async fetch(ctx, signal, options, providerID) {
    let notice: Snapshot = { kind: "notice", text: "未登录 Console" }
    let failure: unknown

    try {
      const location = ctx.location ?? ctx.data.location.default()
      const response = await ctx.client.experimental.usage.limits({ location })
      if (signal.aborted) throw new QuotaError("aborted")

      const info = response.data
      if (info?.go) {
        return {
          kind: "go",
          rolling: info.go.rolling,
          weekly: info.go.weekly,
          monthly: info.go.monthly,
          usageURL: info.workspace.usageURL,
        }
      }
      if (info) notice = { kind: "notice", text: "工作区未开通 Go" }
    } catch (error) {
      if (signal.aborted) throw new QuotaError("aborted")
      failure = error
    }

    const fromKey = await goUsageFromKey(ctx, signal, options, providerID)
    if (fromKey) return fromKey
    if (failure) throw failure
    return notice
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

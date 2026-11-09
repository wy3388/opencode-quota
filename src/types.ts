import type { Plugin } from "@opencode/plugin/tui"

type Context = Plugin.Context

/** One Go allowance window: how much of the plan limit it counted, and when it resets. */
export type Meter = {
  readonly percent: number
  readonly limited: boolean
  readonly resetsAt: number
}

/** What a provider adapter renders. Every variant is display-ready. */
export type Snapshot =
  | {
      readonly kind: "go"
      readonly rolling: Meter
      readonly weekly: Meter
      readonly monthly: Meter
      readonly usageURL: string
    }
  | {
      readonly kind: "ollama"
      readonly remaining?: number
      readonly allowance?: number
      readonly purchased?: number
      readonly resetAt?: number
      /** Legacy plans report percentages instead of dollars. */
      readonly session?: number
      readonly weekly?: number
    }
  | {
      readonly kind: "deepseek"
      readonly available: boolean
      readonly balances: ReadonlyArray<{
        readonly currency: string
        readonly total: number
        readonly granted?: number
        readonly toppedUp?: number
      }>
    }
  | {
      readonly kind: "notice"
      readonly text: string
    }

export type Entry = {
  readonly snapshot?: Snapshot
  readonly error?: string
  readonly at?: number
  readonly loading?: boolean
  readonly retryAt?: number
}

export type Options = {
  /** Seconds between refreshes of the active provider. Defaults to 60. */
  readonly pollSeconds?: number
  /** Enable the OpenCode Go adapter. Defaults to true. */
  readonly go?: boolean
  /** Enable the Ollama Cloud adapter. Defaults to true. */
  readonly ollama?: boolean
  /** Ollama Cloud API key. Falls back to OLLAMA_API_KEY, then auth.json. */
  readonly ollamaKey?: string
  /** Ollama Cloud base URL. Defaults to https://ollama.com. */
  readonly ollamaBaseURL?: string
  /** Enable the DeepSeek adapter. Defaults to true. */
  readonly deepseek?: boolean
  /** DeepSeek API key. Falls back to DEEPSEEK_API_KEY, then stored credentials. */
  readonly deepseekKey?: string
  /** DeepSeek API base URL. Defaults to https://api.deepseek.com. */
  readonly deepseekBaseURL?: string
  /** Also show the current provider's quota on the home footer. Defaults to false. */
  readonly homeFooter?: boolean
}

export type Adapter = {
  readonly id: string
  readonly label: string
  readonly fetch: (ctx: Context, signal: AbortSignal, options: Options, providerID: string) => Promise<Snapshot>
}

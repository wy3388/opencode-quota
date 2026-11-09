import { createSignal } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import type { Entry, Options } from "./types"
import { adapterFor } from "./providers"
import { errorCode, retryDelay } from "./errors"
import { debug } from "./debug"

type Context = Plugin.Context

export type Engine = {
  /** Reactive per-provider entries, keyed by OpenCode provider ID. */
  entries(): Record<string, Entry | undefined>
  /** Point the poller at the provider behind the current model. */
  activate(providerID: string | undefined): void
  /** Force a refresh of one provider. */
  refresh(providerID: string | undefined): void
  /** Stop timers and in-flight requests. */
  dispose(): void
}

export function createEngine(context: Context, options: Options): Engine {
  const [entries, setEntries] = createSignal<Record<string, Entry | undefined>>({})
  const intervalMs = Math.max(15, options.pollSeconds ?? 60) * 1000

  let active: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let controller: AbortController | undefined
  let disposed = false

  const patch = (providerID: string, next: Partial<Entry>) => {
    setEntries((previous) => ({
      ...previous,
      [providerID]: { ...(previous[providerID] ?? {}), ...next },
    }))
  }

  async function load(providerID: string, force: boolean) {
    if (disposed) return
    const adapter = adapterFor(providerID, options)
    if (!adapter) {
      debug("no adapter", { providerID })
      return
    }

    const current = entries()[providerID]
    const now = Date.now()
    if (!force) {
      if (current?.retryAt && now < current.retryAt) return
      if (current?.at && now - current.at < intervalMs) return
    }

    controller?.abort()
    const request = new AbortController()
    controller = request
    patch(providerID, { loading: true })

    try {
      debug("fetch start", { providerID })
      const snapshot = await adapter.fetch(context, request.signal, options)
      if (request.signal.aborted || disposed) return
      debug("fetch ok", { providerID, kind: snapshot.kind })
      patch(providerID, { snapshot, at: Date.now(), error: undefined, loading: false, retryAt: undefined })
    } catch (error) {
      if (request.signal.aborted || disposed) return
      const delay = retryDelay(error)
      debug("fetch error", { providerID, message: error instanceof Error ? error.message : String(error) })
      patch(providerID, {
        error: errorCode(error),
        loading: false,
        retryAt: delay ? Date.now() + delay : undefined,
      })
    }
  }

  function activate(providerID: string | undefined) {
    if (disposed) return
    if (providerID === active) return

    active = providerID
    controller?.abort()
    if (timer) clearInterval(timer)
    timer = undefined

    if (!providerID || !adapterFor(providerID, options)) return

    void load(providerID, false)
    timer = setInterval(() => void load(providerID, true), intervalMs)
  }

  function refresh(providerID: string | undefined) {
    if (!providerID) return
    void load(providerID, true)
  }

  function dispose() {
    disposed = true
    controller?.abort()
    if (timer) clearInterval(timer)
    timer = undefined
  }

  return { entries, activate, refresh, dispose }
}

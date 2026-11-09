import { Plugin } from "@opencode/plugin/tui"

type Context = Plugin.Context

import { Show, createEffect, createMemo } from "solid-js"
import type { Entry, Options, Snapshot } from "./types"
import { createEngine, type Engine } from "./engine"
import { adapterFor } from "./providers"
import { age, money, percent, resetTime } from "./format"
import { debug } from "./debug"

type Tone = "base" | "muted" | "warning" | "error"

type View = {
  readonly label: string
  readonly text: string
  readonly tone: Tone
}

function toneColor(context: Context, tone: Tone) {
  const theme = context.theme
  if (tone === "error") return theme.text.feedback.error.base
  if (tone === "warning") return theme.text.feedback.warning.base
  if (tone === "base") return theme.text.base
  return theme.text.muted
}

function goView(snapshot: Extract<Snapshot, { kind: "go" }>): View {
  const worst = Math.max(snapshot.rolling.percent, snapshot.weekly.percent, snapshot.monthly.percent)
  return {
    label: "Go",
    text: `5h ${percent(snapshot.rolling.percent)} · 7d ${percent(snapshot.weekly.percent)} · 1M ${percent(snapshot.monthly.percent)}`,
    tone: worst >= 90 ? "error" : worst >= 75 ? "warning" : "muted",
  }
}

function ollamaView(snapshot: Extract<Snapshot, { kind: "ollama" }>): View {
  let text: string
  let tone: Tone = "muted"

  if (snapshot.remaining !== undefined && snapshot.allowance !== undefined) {
    text = `${money(snapshot.remaining)} / ${money(snapshot.allowance)}`
    if (snapshot.allowance > 0) {
      const ratio = snapshot.remaining / snapshot.allowance
      tone = ratio < 0.1 ? "error" : ratio < 0.25 ? "warning" : "muted"
    }
  } else if (snapshot.session !== undefined || snapshot.weekly !== undefined) {
    const parts: string[] = []
    if (snapshot.session !== undefined) parts.push(`5h ${percent(snapshot.session)}`)
    if (snapshot.weekly !== undefined) parts.push(`7d ${percent(snapshot.weekly)}`)
    text = parts.join(" · ")
    const worst = Math.max(snapshot.session ?? 0, snapshot.weekly ?? 0)
    tone = worst <= 10 ? "error" : worst <= 25 ? "warning" : "muted"
  } else {
    text = "—"
  }

  if (snapshot.purchased !== undefined && snapshot.purchased > 0) {
    text += ` +${money(snapshot.purchased)}`
  }

  return { label: "Ollama", text, tone }
}

function viewFor(snapshot: Snapshot): View {
  if (snapshot.kind === "go") return goView(snapshot)
  if (snapshot.kind === "ollama") return ollamaView(snapshot)
  return { label: "", text: snapshot.text, tone: "muted" }
}

const errorText = (code: string | undefined): string | undefined => {
  if (!code) return undefined
  if (code === "aborted") return undefined
  if (code === "限流") return "限流，稍后重试"
  return "获取失败"
}

function QuotaLine(props: { context: Context; engine: Engine; options: Options; sessionID?: string }) {
  const context = props.context

  const providerID = createMemo(() => {
    const selected = context.ui.model.current()?.providerID
    if (selected) return selected
    if (!props.sessionID) return undefined
    return context.data.session.get(props.sessionID)?.model?.providerID
  })

  createEffect(() => props.engine.activate(providerID()))

  const adapter = createMemo(() => adapterFor(providerID(), props.options))

  const entry = createMemo<Entry | undefined>(() => {
    const id = providerID()
    return id ? props.engine.entries()[id] : undefined
  })

  const view = createMemo<View | undefined>(() => {
    const current = entry()
    if (!current) return undefined
    if (current.snapshot) return viewFor(current.snapshot)
    const text = errorText(current.error)
    return text ? { label: "", text, tone: "error" } : undefined
  })


  return (
    <Show when={adapter()}>
      <Show when={view()}>
        {(current: () => View) => (
          <text>
            <span style={{ fg: context.theme.text.base }}>{current().label}</span>
            <span style={{ fg: toneColor(context, current().tone) }}>
              {current().label ? ` ${current().text}` : current().text}
            </span>
          </text>
        )}
      </Show>
    </Show>
  )
}

function details(context: Context, engine: Engine, options: Options, sessionID?: string): string[] {
  const providerID = context.ui.model.current()?.providerID ?? (sessionID ? context.data.session.get(sessionID)?.model?.providerID : undefined)
  if (!providerID) return ["当前没有选中的模型"]
  const adapter = adapterFor(providerID, options)
  if (!adapter) return [`${providerID} 没有余额数据源`]

  const entry = engine.entries()[providerID]
  const snapshot = entry?.snapshot
  if (!snapshot) {
    const text = errorText(entry?.error)
    return [text ?? "正在获取…"]
  }

  const lines = [`提供商: ${providerID}`]
  if (snapshot.kind === "go") {
    lines.push(`5 小时: 已用 ${percent(snapshot.rolling.percent)}${snapshot.rolling.limited ? "（已受限）" : ""}`)
    const rolling = resetTime(snapshot.rolling.resetsAt)
    if (rolling) lines.push(`  重置: ${rolling}`)
    lines.push(`本周: 已用 ${percent(snapshot.weekly.percent)}`)
    const weekly = resetTime(snapshot.weekly.resetsAt)
    if (weekly) lines.push(`  重置: ${weekly}`)
    lines.push(`本月: 已用 ${percent(snapshot.monthly.percent)}`)
    const monthly = resetTime(snapshot.monthly.resetsAt)
    if (monthly) lines.push(`  重置: ${monthly}`)
    lines.push(`控制台: ${snapshot.usageURL}`)
  } else if (snapshot.kind === "ollama") {
    if (snapshot.remaining !== undefined) {
      const allowance = snapshot.allowance !== undefined ? ` / ${money(snapshot.allowance)}` : ""
      lines.push(`剩余额度: ${money(snapshot.remaining)}${allowance}`)
    }
    if (snapshot.purchased !== undefined && snapshot.purchased > 0) {
      lines.push(`额外购买: ${money(snapshot.purchased)}`)
    }
    if (snapshot.session !== undefined) lines.push(`5 小时剩余: ${percent(snapshot.session)}`)
    if (snapshot.weekly !== undefined) lines.push(`本周剩余: ${percent(snapshot.weekly)}`)
    const reset = resetTime(snapshot.resetAt)
    if (reset) lines.push(`周期重置: ${reset}`)
  } else {
    lines.push(snapshot.text)
  }

  const updated = age(entry?.at)
  if (updated) lines.push(`更新于: ${updated}`)
  return lines
}

export default Plugin.define({
  id: "quota.sidebar",
  setup(context) {
    debug("setup", { version: context.app.version })
    const options = context.options as Options
    const engine = createEngine(context, options)
    const cleanups: Array<() => void> = []

    cleanups.push(
      context.ui.slot({
        prepend: "sidebar.content",
        render: (input) => <QuotaLine context={context} engine={engine} options={options} sessionID={input.sessionID} />,
      }),
    )

    if (options.homeFooter) {
      cleanups.push(
        context.ui.slot({
          append: "home.footer.status",
          render: () => <QuotaLine context={context} engine={engine} options={options} />,
        }),
      )
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "quota.show",
          title: "Quota: show details",
          group: "Quota",
          palette: true,
          slash: { name: "quota", aliases: ["balance"] },
          run: async () => {
            const route = context.ui.router.current()
            const sessionID = route.type === "session" ? route.sessionID : undefined
            engine.refresh(context.ui.model.current()?.providerID)
            await context.ui.dialog.alert({
              title: "Quota",
              message: details(context, engine, options, sessionID).join("\n"),
            })
          },
        },
        {
          id: "quota.refresh",
          title: "Quota: refresh now",
          group: "Quota",
          palette: true,
          run: async () => {
            engine.refresh(context.ui.model.current()?.providerID)
            context.ui.toast.show({ message: "已刷新额度", variant: "info" })
          },
        },
      ],
      bindings: ["quota.show", "quota.refresh"],
    }))

    return () => {
      for (const cleanup of cleanups) cleanup()
      engine.dispose()
    }
  },
})

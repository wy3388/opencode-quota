import { appendFileSync } from "node:fs"

/**
 * Opt-in tracing. Set QUOTA_DEBUG=1 to append plugin events to
 * $TMPDIR/opencode-quota.log. Never pass secrets here.
 */
export function debug(message: string, data?: unknown): void {
  if (!process.env.QUOTA_DEBUG) return
  try {
    const line = `${new Date().toISOString()} ${message}${data === undefined ? "" : ` ${JSON.stringify(data)}`}\n`
    appendFileSync(`${process.env.TMPDIR ?? "/tmp"}/opencode-quota.log`, line)
  } catch {
    // tracing must never break the UI
  }
}

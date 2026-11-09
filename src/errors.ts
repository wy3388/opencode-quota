/** Provider request failed with a short, display-safe code. */
export class QuotaError extends Error {
  readonly code: string
  readonly retryAfterMs?: number

  constructor(code: string, retryAfterMs?: number) {
    super(code)
    this.name = "QuotaError"
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

/** Map any thrown value to a short code the sidebar can show. */
export function errorCode(error: unknown): string {
  if (error instanceof QuotaError) return error.code
  if (error instanceof Error && error.name === "AbortError") return "aborted"
  return "failed"
}

export function retryDelay(error: unknown): number | undefined {
  return error instanceof QuotaError ? error.retryAfterMs : undefined
}

/** Round a percentage for display. */
export function percent(value: number): string {
  const rounded = Math.round(value)
  return `${rounded}%`
}

/** US dollars, with cents only when they matter. */
export function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Currency-aware amount, e.g. ¥110.00 or $72.50. */
export function moneyIn(currency: string, value: number): string {
  try {
    return new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

/** Local reset time, short form. */
export function resetTime(value: number | undefined): string | undefined {
  if (!value || !Number.isFinite(value)) return undefined
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Coarse age of a timestamp, for "last updated" hints. */
export function age(value: number | undefined): string | undefined {
  if (!value) return undefined
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000))
  if (seconds < 60) return "刚刚"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m 前`
  return `${Math.round(minutes / 60)}h 前`
}

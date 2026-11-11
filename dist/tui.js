// src/tui.tsx
import { setProp as _$setProp } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { Show, createEffect, createMemo } from "solid-js";

// src/engine.ts
import { createSignal } from "solid-js";

// src/errors.ts
var QuotaError = class extends Error {
  code;
  retryAfterMs;
  constructor(code, retryAfterMs) {
    super(code);
    this.name = "QuotaError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
};
function errorCode(error) {
  if (error instanceof QuotaError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "failed";
}
function retryDelay(error) {
  return error instanceof QuotaError ? error.retryAfterMs : void 0;
}

// src/keys.ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
function dataDirectory() {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  if (xdg) return join(xdg, "opencode");
  return join(process.env.HOME?.trim() || homedir(), ".local", "share", "opencode");
}
async function resolveProviderKey(context, providerID, overrides = {}) {
  const fromOptions = typeof overrides.option === "string" ? overrides.option.trim() : "";
  if (fromOptions) return fromOptions;
  const fromEnv = overrides.env ? process.env[overrides.env]?.trim() : void 0;
  if (fromEnv) return fromEnv;
  const fromIntegration = await readIntegrationKey(context, providerID);
  if (fromIntegration) return fromIntegration;
  return readStoredKey(providerID);
}
async function readIntegrationKey(context, providerID) {
  try {
    const providers = context.data.location.provider.list(context.location) ?? [];
    const provider = providers.find((entry) => entry.id === providerID);
    const integrationID = provider?.integrationID ?? providerID;
    const credentials = await context.client.credential.list();
    const candidates = credentials.filter(
      (entry) => entry.active !== false && (entry.integrationID === integrationID || entry.integrationID === providerID)
    );
    for (const entry of candidates) {
      const value = entry.value;
      const secret = value.type === "key" ? value.key : value.type === "oauth" ? value.access : void 0;
      const trimmed = secret?.trim();
      if (trimmed) return trimmed;
    }
    return void 0;
  } catch {
    return void 0;
  }
}
async function readStoredKey(providerID) {
  try {
    const raw = await readFile(join(dataDirectory(), "auth.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return void 0;
    const record = parsed;
    const key = record[providerID]?.key;
    if (typeof key !== "string") return void 0;
    const trimmed = key.trim();
    return trimmed.length > 0 ? trimmed : void 0;
  } catch {
    return void 0;
  }
}

// src/providers.ts
var number = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
var decimal = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return void 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : void 0;
};
var retryAfter = (response) => {
  const header = Number(response.headers.get("retry-after") ?? "");
  const seconds = Number.isFinite(header) && header > 0 ? header : 60;
  throw new QuotaError("\u9650\u6D41", seconds * 1e3);
};
var isoTime = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return void 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : void 0;
};
var goMeter = (value) => {
  const percent2 = number(value?.percent);
  const resetsAt = isoTime(value?.resetsAt);
  if (percent2 === void 0 || resetsAt === void 0) return void 0;
  const limited = typeof value?.status === "string" ? value.status !== "ok" : percent2 >= 100;
  return { percent: percent2, limited, resetsAt };
};
var GO_USAGE_FALLBACK = "https://opencode.ai/zen/go/v1";
var GO_CONSOLE_URL = "https://opencode.ai/console/go";
function goUsageEndpoint(base) {
  const trimmed = base.trim().replace(/\/+$/, "").replace(/\/openai\/v1$/, "/v1").replace(/\/openai$/, "");
  return `${trimmed}/usage`;
}
function providerBaseURL(ctx, providerID) {
  try {
    const providers = ctx.data.location.provider.list(ctx.location) ?? [];
    const base = providers.find((entry) => entry.id === providerID)?.settings?.baseURL;
    return typeof base === "string" && base.trim() ? base.trim() : void 0;
  } catch {
    return void 0;
  }
}
async function goUsageFromKey(ctx, signal, options, providerID) {
  const key = await resolveProviderKey(ctx, providerID, { option: options.goKey, env: "OPENCODE_API_KEY" });
  if (!key) return void 0;
  const base = options.goBaseURL ?? providerBaseURL(ctx, providerID) ?? GO_USAGE_FALLBACK;
  const response = await fetch(goUsageEndpoint(base), {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal
  });
  if (response.status === 401 || response.status === 403) return { kind: "notice", text: "key \u65E0\u6548" };
  if (response.status === 429) retryAfter(response);
  if (!response.ok) throw new QuotaError(String(response.status));
  const body = await response.json();
  const usage = body?.usage ?? body;
  const rolling = goMeter(usage?.rolling);
  const weekly = goMeter(usage?.weekly);
  const monthly = goMeter(usage?.monthly);
  if (!rolling || !weekly || !monthly) return { kind: "notice", text: "\u65E0\u7528\u91CF\u6570\u636E" };
  return { kind: "go", rolling, weekly, monthly, usageURL: options.goUsageURL ?? GO_CONSOLE_URL };
}
var goAdapter = {
  id: "opencode-go",
  label: "Go",
  async fetch(ctx, signal, options, providerID) {
    let notice = { kind: "notice", text: "\u672A\u767B\u5F55 Console" };
    let failure;
    try {
      const location = ctx.location ?? ctx.data.location.default();
      const response = await ctx.client.experimental.usage.limits({ location });
      if (signal.aborted) throw new QuotaError("aborted");
      const info = response.data;
      if (info?.go) {
        return {
          kind: "go",
          rolling: info.go.rolling,
          weekly: info.go.weekly,
          monthly: info.go.monthly,
          usageURL: info.workspace.usageURL
        };
      }
      if (info) notice = { kind: "notice", text: "\u5DE5\u4F5C\u533A\u672A\u5F00\u901A Go" };
    } catch (error) {
      if (signal.aborted) throw new QuotaError("aborted");
      failure = error;
    }
    const fromKey = await goUsageFromKey(ctx, signal, options, providerID);
    if (fromKey) return fromKey;
    if (failure) throw failure;
    return notice;
  }
};
var ollamaAdapter = {
  id: "ollama",
  label: "Ollama",
  async fetch(ctx, signal, options, providerID) {
    const key = await resolveProviderKey(ctx, providerID, { option: options.ollamaKey, env: "OLLAMA_API_KEY" });
    if (!key) return { kind: "notice", text: "\u672A\u914D\u7F6E key" };
    const base = (options.ollamaBaseURL ?? "https://ollama.com").replace(/\/+$/, "");
    const response = await fetch(`${base}/api/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal
    });
    if (response.status === 401 || response.status === 403) return { kind: "notice", text: "key \u65E0\u6548" };
    if (response.status === 429) retryAfter(response);
    if (!response.ok) throw new QuotaError(String(response.status));
    const body = await response.json();
    const included = body?.included ?? {};
    const purchased = body?.purchased ?? {};
    const snapshot = {
      kind: "ollama",
      remaining: number(included.balance_usd),
      allowance: number(included.allowance_usd),
      purchased: number(purchased.balance_usd),
      resetAt: typeof included.period?.until === "string" ? Date.parse(included.period.until) || void 0 : void 0,
      session: number(included.session?.remaining_percent),
      weekly: number(included.weekly?.remaining_percent)
    };
    if (snapshot.remaining === void 0 && snapshot.allowance === void 0 && snapshot.session === void 0 && snapshot.weekly === void 0) {
      return { kind: "notice", text: "\u65E0\u4F59\u989D\u6570\u636E" };
    }
    return snapshot;
  }
};
var deepseekAdapter = {
  id: "deepseek",
  label: "DeepSeek",
  async fetch(ctx, signal, options, providerID) {
    const key = await resolveProviderKey(ctx, providerID, { option: options.deepseekKey, env: "DEEPSEEK_API_KEY" });
    if (!key) return { kind: "notice", text: "\u672A\u914D\u7F6E key" };
    const base = (options.deepseekBaseURL ?? "https://api.deepseek.com").replace(/\/+$/, "");
    const response = await fetch(`${base}/user/balance`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal
    });
    if (response.status === 401 || response.status === 403) return { kind: "notice", text: "key \u65E0\u6548" };
    if (response.status === 429) retryAfter(response);
    if (!response.ok) throw new QuotaError(String(response.status));
    const body = await response.json();
    const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
    const balances = infos.flatMap((info) => {
      const currency = typeof info?.currency === "string" ? info.currency : void 0;
      const total = decimal(info?.total_balance);
      if (!currency || total === void 0) return [];
      return [
        {
          currency,
          total,
          granted: decimal(info?.granted_balance),
          toppedUp: decimal(info?.topped_up_balance)
        }
      ];
    });
    if (balances.length === 0) return { kind: "notice", text: "\u65E0\u4F59\u989D\u6570\u636E" };
    return { kind: "deepseek", available: body?.is_available !== false, balances };
  }
};
var adapters = [goAdapter, ollamaAdapter, deepseekAdapter];
function adapterFor(providerID, options) {
  if (!providerID) return void 0;
  const id = providerID.toLowerCase();
  return adapters.find((adapter) => {
    if (adapter.id === "opencode-go") return options.go !== false && id === adapter.id;
    if (adapter.id === "ollama") return options.ollama !== false && (id === adapter.id || id.startsWith("ollama-"));
    if (adapter.id === "deepseek") return options.deepseek !== false && (id === adapter.id || id.startsWith("deepseek-"));
    return false;
  });
}

// src/debug.ts
import { appendFileSync } from "node:fs";
function debug(message, data) {
  if (!process.env.QUOTA_DEBUG) return;
  try {
    const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${message}${data === void 0 ? "" : ` ${JSON.stringify(data)}`}
`;
    appendFileSync(`${process.env.TMPDIR ?? "/tmp"}/opencode-quota.log`, line);
  } catch {
  }
}

// src/engine.ts
function createEngine(context, options) {
  const [entries, setEntries] = createSignal({});
  const intervalMs = Math.max(15, options.pollSeconds ?? 60) * 1e3;
  let active;
  let timer;
  let controller;
  let disposed = false;
  const patch = (providerID, next) => {
    setEntries((previous) => ({
      ...previous,
      [providerID]: { ...previous[providerID] ?? {}, ...next }
    }));
  };
  async function load(providerID, force) {
    if (disposed) return;
    const adapter = adapterFor(providerID, options);
    if (!adapter) {
      debug("no adapter", { providerID });
      return;
    }
    const current = entries()[providerID];
    const now = Date.now();
    if (!force) {
      if (current?.retryAt && now < current.retryAt) return;
      if (current?.at && now - current.at < intervalMs) return;
    }
    controller?.abort();
    const request = new AbortController();
    controller = request;
    patch(providerID, { loading: true });
    try {
      debug("fetch start", { providerID });
      const snapshot = await adapter.fetch(context, request.signal, options, providerID);
      if (request.signal.aborted || disposed) return;
      debug("fetch ok", { providerID, kind: snapshot.kind });
      patch(providerID, { snapshot, at: Date.now(), error: void 0, loading: false, retryAt: void 0 });
    } catch (error) {
      if (request.signal.aborted || disposed) return;
      const delay = retryDelay(error);
      debug("fetch error", { providerID, message: error instanceof Error ? error.message : String(error) });
      patch(providerID, {
        error: errorCode(error),
        loading: false,
        retryAt: delay ? Date.now() + delay : void 0
      });
    }
  }
  function activate(providerID) {
    if (disposed) return;
    if (providerID === active) return;
    active = providerID;
    controller?.abort();
    if (timer) clearInterval(timer);
    timer = void 0;
    if (!providerID || !adapterFor(providerID, options)) return;
    void load(providerID, false);
    timer = setInterval(() => void load(providerID, true), intervalMs);
  }
  function refresh(providerID) {
    if (!providerID) return;
    void load(providerID, true);
  }
  function dispose() {
    disposed = true;
    controller?.abort();
    if (timer) clearInterval(timer);
    timer = void 0;
  }
  return { entries, activate, refresh, dispose };
}

// src/format.ts
function percent(value) {
  const rounded = Math.round(value);
  return `${rounded}%`;
}
function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}
function moneyIn(currency, value) {
  try {
    return new Intl.NumberFormat(currency === "CNY" ? "zh-CN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
function resetTime(value) {
  if (!value || !Number.isFinite(value)) return void 0;
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function age(value) {
  if (!value) return void 0;
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1e3));
  if (seconds < 60) return "\u521A\u521A";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m \u524D`;
  return `${Math.round(minutes / 60)}h \u524D`;
}

// src/tui.tsx
function toneColor(context, tone) {
  const theme = context.theme;
  if (tone === "error") return theme.text.feedback.error.base;
  if (tone === "warning") return theme.text.feedback.warning.base;
  if (tone === "base") return theme.text.base;
  return theme.text.muted;
}
function goView(snapshot) {
  const worst = Math.max(snapshot.rolling.percent, snapshot.weekly.percent, snapshot.monthly.percent);
  return {
    label: "Go",
    text: `5h ${percent(snapshot.rolling.percent)} \xB7 7d ${percent(snapshot.weekly.percent)} \xB7 1M ${percent(snapshot.monthly.percent)}`,
    tone: worst >= 90 ? "error" : worst >= 75 ? "warning" : "muted"
  };
}
function ollamaView(snapshot) {
  let text;
  let tone = "muted";
  if (snapshot.remaining !== void 0 && snapshot.allowance !== void 0) {
    text = `${money(snapshot.remaining)} / ${money(snapshot.allowance)}`;
    if (snapshot.allowance > 0) {
      const ratio = snapshot.remaining / snapshot.allowance;
      tone = ratio < 0.1 ? "error" : ratio < 0.25 ? "warning" : "muted";
    }
  } else if (snapshot.session !== void 0 || snapshot.weekly !== void 0) {
    const parts = [];
    if (snapshot.session !== void 0) parts.push(`5h ${percent(snapshot.session)}`);
    if (snapshot.weekly !== void 0) parts.push(`7d ${percent(snapshot.weekly)}`);
    text = parts.join(" \xB7 ");
    const worst = Math.max(snapshot.session ?? 0, snapshot.weekly ?? 0);
    tone = worst <= 10 ? "error" : worst <= 25 ? "warning" : "muted";
  } else {
    text = "\u2014";
  }
  if (snapshot.purchased !== void 0 && snapshot.purchased > 0) {
    text += ` +${money(snapshot.purchased)}`;
  }
  return {
    label: "Ollama",
    text,
    tone
  };
}
function deepseekView(snapshot) {
  const primary = snapshot.balances[0];
  if (!primary) {
    return {
      label: "DeepSeek",
      text: snapshot.available ? "\u2014" : "\u4F59\u989D\u4E0D\u8DB3",
      tone: snapshot.available ? "muted" : "error"
    };
  }
  const tone = !snapshot.available || primary.total < 10 ? "error" : primary.total < 30 ? "warning" : "muted";
  return {
    label: "DeepSeek",
    text: moneyIn(primary.currency, primary.total),
    tone
  };
}
function viewFor(snapshot) {
  if (snapshot.kind === "go") return goView(snapshot);
  if (snapshot.kind === "ollama") return ollamaView(snapshot);
  if (snapshot.kind === "deepseek") return deepseekView(snapshot);
  return {
    label: "",
    text: snapshot.text,
    tone: "muted"
  };
}
var errorText = (code) => {
  if (!code) return void 0;
  if (code === "aborted") return void 0;
  if (code === "\u9650\u6D41") return "\u9650\u6D41\uFF0C\u7A0D\u540E\u91CD\u8BD5";
  return "\u83B7\u53D6\u5931\u8D25";
};
function QuotaLine(props) {
  const context = props.context;
  const providerID = createMemo(() => {
    const selected = context.ui.model.current()?.providerID;
    if (selected) return selected;
    if (!props.sessionID) return void 0;
    return context.data.session.get(props.sessionID)?.model?.providerID;
  });
  createEffect(() => props.engine.activate(providerID()));
  const adapter = createMemo(() => adapterFor(providerID(), props.options));
  const entry = createMemo(() => {
    const id = providerID();
    return id ? props.engine.entries()[id] : void 0;
  });
  const view = createMemo(() => {
    const current = entry();
    if (!current) return void 0;
    if (current.snapshot) return viewFor(current.snapshot);
    const text = errorText(current.error);
    return text ? {
      label: "",
      text,
      tone: "error"
    } : void 0;
  });
  return _$createComponent(Show, {
    get when() {
      return adapter();
    },
    get children() {
      return _$createComponent(Show, {
        get when() {
          return view();
        },
        children: (current) => (() => {
          var _el$ = _$createElement("text"), _el$2 = _$createElement("span"), _el$3 = _$createElement("span");
          _$insertNode(_el$, _el$2);
          _$insertNode(_el$, _el$3);
          _$insert(_el$2, () => current().label);
          _$insert(_el$3, (() => {
            var _c$ = _$memo(() => !!current().label);
            return () => _c$() ? ` ${current().text}` : current().text;
          })());
          _$effect((_p$) => {
            var _v$ = {
              fg: context.theme.text.base
            }, _v$2 = {
              fg: toneColor(context, current().tone)
            };
            _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "style", _v$, _p$.e));
            _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "style", _v$2, _p$.t));
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$;
        })()
      });
    }
  });
}
function details(context, engine, options, sessionID) {
  const providerID = context.ui.model.current()?.providerID ?? (sessionID ? context.data.session.get(sessionID)?.model?.providerID : void 0);
  if (!providerID) return ["\u5F53\u524D\u6CA1\u6709\u9009\u4E2D\u7684\u6A21\u578B"];
  const adapter = adapterFor(providerID, options);
  if (!adapter) return [`${providerID} \u6CA1\u6709\u4F59\u989D\u6570\u636E\u6E90`];
  const entry = engine.entries()[providerID];
  const snapshot = entry?.snapshot;
  if (!snapshot) {
    const text = errorText(entry?.error);
    return [text ?? "\u6B63\u5728\u83B7\u53D6\u2026"];
  }
  const lines = [`\u63D0\u4F9B\u5546: ${providerID}`];
  if (snapshot.kind === "go") {
    lines.push(`5 \u5C0F\u65F6: \u5DF2\u7528 ${percent(snapshot.rolling.percent)}${snapshot.rolling.limited ? "\uFF08\u5DF2\u53D7\u9650\uFF09" : ""}`);
    const rolling = resetTime(snapshot.rolling.resetsAt);
    if (rolling) lines.push(`  \u91CD\u7F6E: ${rolling}`);
    lines.push(`\u672C\u5468: \u5DF2\u7528 ${percent(snapshot.weekly.percent)}`);
    const weekly = resetTime(snapshot.weekly.resetsAt);
    if (weekly) lines.push(`  \u91CD\u7F6E: ${weekly}`);
    lines.push(`\u672C\u6708: \u5DF2\u7528 ${percent(snapshot.monthly.percent)}`);
    const monthly = resetTime(snapshot.monthly.resetsAt);
    if (monthly) lines.push(`  \u91CD\u7F6E: ${monthly}`);
    lines.push(`\u63A7\u5236\u53F0: ${snapshot.usageURL}`);
  } else if (snapshot.kind === "ollama") {
    if (snapshot.remaining !== void 0) {
      const allowance = snapshot.allowance !== void 0 ? ` / ${money(snapshot.allowance)}` : "";
      lines.push(`\u5269\u4F59\u989D\u5EA6: ${money(snapshot.remaining)}${allowance}`);
    }
    if (snapshot.purchased !== void 0 && snapshot.purchased > 0) {
      lines.push(`\u989D\u5916\u8D2D\u4E70: ${money(snapshot.purchased)}`);
    }
    if (snapshot.session !== void 0) lines.push(`5 \u5C0F\u65F6\u5269\u4F59: ${percent(snapshot.session)}`);
    if (snapshot.weekly !== void 0) lines.push(`\u672C\u5468\u5269\u4F59: ${percent(snapshot.weekly)}`);
    const reset = resetTime(snapshot.resetAt);
    if (reset) lines.push(`\u5468\u671F\u91CD\u7F6E: ${reset}`);
  } else if (snapshot.kind === "deepseek") {
    lines.push(`\u53EF\u7528\u72B6\u6001: ${snapshot.available ? "\u6B63\u5E38" : "\u4F59\u989D\u4E0D\u8DB3"}`);
    for (const balance of snapshot.balances) {
      const parts = [`\u603B\u989D ${moneyIn(balance.currency, balance.total)}`];
      if (balance.granted !== void 0) parts.push(`\u8D60\u9001 ${moneyIn(balance.currency, balance.granted)}`);
      if (balance.toppedUp !== void 0) parts.push(`\u5145\u503C ${moneyIn(balance.currency, balance.toppedUp)}`);
      lines.push(`${balance.currency}: ${parts.join(" \xB7 ")}`);
    }
  } else {
    lines.push(snapshot.text);
  }
  const updated = age(entry?.at);
  if (updated) lines.push(`\u66F4\u65B0\u4E8E: ${updated}`);
  return lines;
}
var tui_default = Plugin.define({
  id: "quota.sidebar",
  setup(context) {
    debug("setup", {
      version: context.app.version
    });
    const options = context.options;
    const engine = createEngine(context, options);
    const cleanups = [];
    cleanups.push(context.ui.slot({
      prepend: "sidebar.content",
      render: (input) => _$createComponent(QuotaLine, {
        context,
        engine,
        options,
        get sessionID() {
          return input.sessionID;
        }
      })
    }));
    if (options.homeFooter) {
      cleanups.push(context.ui.slot({
        append: "home.footer.status",
        render: () => _$createComponent(QuotaLine, {
          context,
          engine,
          options
        })
      }));
    }
    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [{
        id: "quota.show",
        title: "Quota: show details",
        group: "Quota",
        palette: true,
        slash: {
          name: "quota",
          aliases: ["balance"]
        },
        run: async () => {
          const route = context.ui.router.current();
          const sessionID = route.type === "session" ? route.sessionID : void 0;
          engine.refresh(context.ui.model.current()?.providerID);
          await context.ui.dialog.alert({
            title: "Quota",
            message: details(context, engine, options, sessionID).join("\n")
          });
        }
      }, {
        id: "quota.refresh",
        title: "Quota: refresh now",
        group: "Quota",
        palette: true,
        run: async () => {
          engine.refresh(context.ui.model.current()?.providerID);
          context.ui.toast.show({
            message: "\u5DF2\u5237\u65B0\u989D\u5EA6",
            variant: "info"
          });
        }
      }],
      bindings: ["quota.show", "quota.refresh"]
    }));
    return () => {
      for (const cleanup of cleanups) cleanup();
      engine.dispose();
    };
  }
});
export {
  tui_default as default
};

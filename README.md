# opencode-quota

OpenCode TUI 插件：在侧边栏显示**当前模型所属提供商**的剩余额度。

只显示一个提供商，跟随 `/models` 里选中的模型自动切换：

| 当前模型 providerID | 显示 |
| --- | --- |
| `opencode-go` | `Go 5h 24% · 7d 9% · 1M 18%`（滚动 5 小时 / 周 / 月已用比例） |
| `ollama`、`ollama-cloud` | `Ollama $58.04 / $60`（Ollama Cloud 余额 / 额度） |
| 其它（`xai`、`happycoding`…） | 不渲染任何内容 |

## 安装

插件按包加载，入口是构建产物 `dist/tui.js`（必须构建后才能被 OpenCode 读取）。

```json title="~/.config/opencode/cli.json"
{
  "plugins": [
    { "package": "opencode-cache-and-tps@latest", "options": { "enabled": true } },
    "/Users/wangyin/IdeaProjects/opencode-quota"
  ]
}
```

- 条目顺序决定侧边栏位置：`sidebar.content` 只有 `prepend`（最前）和 `append`（最后），
  同为 `prepend` 时按这里的顺序排列。放在 `opencode-cache-and-tps` 之后，
  额度行就出现在缓存面板之下、内置 Context 之上。
- 修改 `cli.json` 后需要重启 TUI（`cli.json` 只在启动时读取）；修改插件代码后按 `/reload`。
- 注意：`cli.json` 里任何一个非法字段都会导致整个文件被忽略、插件全部失效
  （例如 `session.sidebar` 只接受 `"auto"` 或 `"hide"`）。

## 构建

```bash
npm install
npm run build     # src/tui.tsx -> dist/tui.js（Solid 编译器，必须）
npm run dev       # 监听模式，改完在 TUI 里 /reload
npm run typecheck
```

> 必须用 `build.tui.mjs`（esbuild + esbuild-plugin-solid）打包，不能用 Bun 内置 JSX 转换：
> Bun 的 JSX 是 React 式的一次性求值，Solid 的细粒度更新会失效（表现为首次渲染正常、数据更新后界面不动）。

## 配置项

```jsonc
{
  "package": "/Users/wangyin/IdeaProjects/opencode-quota",
  "options": {
    "pollSeconds": 60,       // 刷新间隔，最小 15 秒
    "go": true,              // 启用 OpenCode Go 数据源
    "ollama": true,          // 启用 Ollama Cloud 数据源
    "ollamaKey": "",         // 可选；不填则自动读集成凭据 / OLLAMA_API_KEY / auth.json
    "ollamaBaseURL": "https://ollama.com",
    "homeFooter": false      // 同时在首页 footer 显示
  }
}
```

## 数据来源

- **OpenCode Go**：调用本机 server 的 `client.experimental.usage.limits()`，
  复用已登录的 Console 账号，插件不接触任何 token。未登录时显示「未登录 Console」。
- **Ollama Cloud**：`GET https://ollama.com/api/balance`，Bearer token 依次取自
  插件 `ollamaKey` → `OLLAMA_API_KEY` → **集成凭据**（`client.credential.list()`，
  按 provider 的 `integrationID` 匹配，例如 `ollama-cloud`）→ `~/.local/share/opencode/auth.json`。
  兼容新套餐（美元额度）和旧套餐（`session` / `weekly` 百分比）两种响应。
  key 不会出现在日志、toast 或异常信息中。

## 命令

- `/quota`（别名 `/balance`）：弹窗显示明细、重置时间和控制台链接。
- 命令面板里的 `Quota: refresh now`：立即刷新。

## 已知限制

1. `sidebar.content` 的 slot 只支持 `prepend` / `append`，无法插入到内置区块中间
   （内置顺序固定为 Context → Limit → MCP → Todo）。
2. `experimental.usage.limits` 是实验接口，字段可能变化；解析做了容错，缺字段时整行不渲染。
3. Go 接口只返回百分比，不返回美元；额度上限按模型不同，所以不做金额换算。
4. 侧边栏默认收起（`session.sidebar: "hide"`），需要 `alt+b` 展开。

## 调试

```bash
QUOTA_DEBUG=1 opencode
# 事件写入 $TMPDIR/opencode-quota.log
```

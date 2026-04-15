# TPMail 仓库指引

## 项目边界
- 这是单包 `npm` 项目；脚本与依赖只看根目录 `package.json`，不要按 monorepo、分包或 `pnpm` 工作区思路处理。
- 技术栈以 Next 16 / React 19 / TypeScript / Tailwind 4 为准。
- 根脚本只有 `dev`、`build`、`start`、`lint`；完整验证按 `npm run lint -> npm run build` 执行，局部 lint 可用 `npm run lint -- <路径>`。不要臆造 `test`、`typecheck`、CI、husky/lefthook、turbo/nx/make/just 等入口。

## Next 16 / Tailwind 4 约束
- 本仓库使用 App Router。API 一律走 `src/app/**/route.ts` 的 Route Handlers 和 Web `Request`/`Response` 模型，不要按 Pages Router API Routes 写法处理。
- `params` / `searchParams` / `cookies()` / `headers()` 按 Next 16 规则异步访问；不要写同步读取逻辑。
- 不要默认新增 `middleware.ts`；如确实需要该层能力，先按 Next 16 的 `proxy.ts` 约定核验。
- Tailwind 4 通过 `postcss.config.mjs` + `src/app/globals.css` 接入，并在 CSS 里使用 `@theme inline`；没有 `tailwind.config.*` 是正常的。
- `next.config.ts` 开启了 `output: "standalone"`；部署与容器运行按 Node 服务处理，不要按静态导出站点推断。

## 关键入口与数据流
- 首页 `src/app/page.tsx` 的 provider 首屏数据来自服务端直调 `listProviders()`，不是先请求 `/api/providers`；改 provider 列表逻辑时同时考虑 SSR 首屏与该 API。
- 前端主工作区是 `src/components/tpmail/app-shell.tsx`：负责 provider 选择、建箱、domain 预取、轮询、读信、附件入口和 HTML iframe 沙箱预览；默认 provider 优先 `duckmail`，收件箱每 15 秒自动轮询。
- 后端主干：`src/app/api/**/route.ts -> src/server/tpmail/service.ts -> src/server/tpmail/providers/*.ts`。
- provider 域名列表入口是 `src/app/api/providers/[providerId]/domains/route.ts`；前端建箱前会先拉可用域名。
- 附件下载不是静态文件服务；实际入口是 `src/app/api/mailboxes/[mailboxId]/messages/[messageId]/attachments/[attachmentId]/route.ts`，由后端 `redirect` 到上游地址。
- 共享契约：`src/lib/tpmail/types.ts`、`src/lib/tpmail/errors.ts`。改 API、provider、前端展示前先对齐这里。

## 状态、缓存与校验边界
- 邮箱会话和缓存都在 `src/server/tpmail/store.ts` 的进程内 `globalThis + Map` 中；这是单实例内存态实现，重启即失，不适合多实例一致性假设。
- `/api/providers` 和 `/api/providers/[providerId]/domains` 都会返回 `x-tpmail-cache` 响应头，调试缓存命中时先看它。
- 创建邮箱时，后端会校验 alias 格式，并在传入 domain 时按 provider 可用域名做白名单检查。
- HTML 邮件预览走沙箱 iframe；改这块时不要削弱隔离策略。

## 以代码为准，不要盲信 README
- provider 是否启用，以 `src/server/tpmail/providers/*.ts` 里的 `descriptor.enabled` 为准。
- README 里的 provider 状态可能过时；不要把 README 的启用状态反向同步到代码或 `AGENTS.md`。

## 环境与运行
- 本地启动前先 `cp .env.example .env && npm install`；开发服务器用 `npm run dev`。
- `.env.example` 里的变量只是可选 provider 凭据占位，不代表对应 provider 一定启用；是否启用仍以 `providers/*.ts` 为准。
- 容器部署看 `Dockerfile` 和 `compose.yaml`；最终按 Node 服务运行。

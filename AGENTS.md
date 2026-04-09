# TPMail 仓库指引

## 先看这些事实
- 这是单包 `npm` 项目，不是 monorepo；只存在根目录 `package.json`。
- 技术栈是 `next@16.2.2`、`react@19.2.4`、TypeScript、Tailwind 4。
- 改 Next 相关代码前，先读 `node_modules/next/dist/docs/`，不要套用旧版 Next 经验。

## Next 16 专属注意事项
- 本仓库使用 App Router。API 一律走 `src/app/**/route.ts` 的 Route Handlers 和 Web `Request`/`Response` 模型，不要按 Pages Router API Routes 写法处理。
- `params` / `searchParams` / `cookies()` / `headers()` 按 Next 16 规则异步访问。
- 不要新增 `middleware.ts`；如确实需要对应能力，先查 Next 16 文档中的 `proxy.ts` 约定。
- `next.config.ts` 开启了 `output: "standalone"`。部署与容器运行按 Node 服务处理，不要按静态导出站点推断。

## 真实结构与入口
- 页面入口：`src/app/page.tsx`，首屏会在服务端调用 `listProviders()`。
- 前端主工作区：`src/components/tpmail/app-shell.tsx`，这里负责建箱、轮询、读信、附件入口和 HTML 邮件预览。
- 后端主干：`src/app/api/**/route.ts -> src/server/tpmail/service.ts -> src/server/tpmail/providers/*.ts`。
- 共享契约：`src/lib/tpmail/types.ts`、`src/lib/tpmail/errors.ts`。改 API、provider、前端展示前先对齐这里。

## 状态与数据边界
- 邮箱会话和缓存都在 `src/server/tpmail/store.ts` 的进程内 `Map` / `globalThis` 中；这是单实例内存态实现，重启即失，不适合多实例一致性假设。
- provider 列表和域名列表有内存缓存；相关 HTTP 响应会带 `x-tpmail-cache` 头，调试时可用来判断命中情况。
- HTML 邮件预览走沙箱 iframe；改这块时不要削弱隔离策略。

## 以代码为准，不要盲信 README
- provider 是否启用，以 `src/server/tpmail/providers/*.ts` 里的 `descriptor.enabled` 为准。
- 当前 README 的 provider 状态与源码并非完全一致；例如 `duckmail` 在代码里是启用的。

## 命令与验证
- 安装依赖：`npm install`
- 本地开发：`npm run dev`
- 全量 lint：`npm run lint`
- 局部 lint：`npm run lint -- <路径>`
- 生产构建：`npm run build`
- 生产启动：`npm run start`
- 当前仓库没有已定义的 `test`、`typecheck`、CI workflow、husky/lefthook、turbo/nx/make/just 等入口；不要臆造 `npm test`、`npm run typecheck`、`pnpm` 或分包命令。
- 需要完整验证时，按 `npm run lint` -> `npm run build` 执行。

## 环境与部署
- 本地启动前先 `cp .env.example .env`。
- `.env.example` 里的密钥变量只为 L3 / 商业 provider 预留；当前主路径仍是无需密钥或后端托管 token 的 provider。
- 容器部署看 `Dockerfile` 和 `compose.yaml`；镜像最终运行的是 `.next/standalone` 产物里的 `server.js`。

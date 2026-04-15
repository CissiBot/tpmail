# TPMail

一个面向临时邮箱场景的聚合前端与代理层。TPMail 基于 Next 16、React 19、TypeScript 和 Tailwind 4 构建，把多个 provider 的建箱、读信、附件入口和邮件预览收敛到同一个界面与 API 之下。

仓库当前是**单包 npm 项目**。根目录 `package.json` 提供 `dev`、`build`、`start`、`lint` 四个脚本，运行与验证都以根目录为准。

> [!NOTE]
> provider 是否启用，以 `src/server/tpmail/providers/*.ts` 中各适配器的 `descriptor.enabled` 为准。README 只负责说明当前实现方式，不是最终事实源。

<!-- README-I18N:START -->

**中文** | [English](./README.en-US.md)

<!-- README-I18N:END -->

## 项目简介

这个项目提供一套统一入口，用来接入多个临时邮箱 provider，并在浏览器里完成以下流程：

- 查看可用 provider 列表
- 创建临时邮箱会话
- 拉取收件箱消息列表
- 查看单封邮件的纯文本与 HTML 内容
- 通过 API 路由进入附件下载

首页首屏数据不是先请求 `/api/providers`，而是由 `src/app/page.tsx` 直接调用 `listProviders()`，再把结果注入 `src/components/tpmail/app-shell.tsx`。

## 快速开始

```bash
cp .env.example .env
npm install
npm run dev
```

启动后可在本地访问应用。`.env.example` 中包含若干 provider 预留凭据项，但是否真正启用，仍以 provider 适配器里的 `descriptor.enabled` 为准。

## 功能亮点

- **统一 provider 入口**：服务端聚合 7 个 provider ID，前端按统一契约渲染。
- **首屏服务端注入**：首页直接调用 `listProviders()`，避免首屏额外再打一次 `/api/providers`。
- **单页工作区**：`src/components/tpmail/app-shell.tsx` 负责 provider 切换、建箱、域名预取、最近邮箱列表、接管已有会话、读信、附件入口和邮件预览。
- **域名预取后再建箱**：切换 provider 后，前端会先请求 `/api/providers/[providerId]/domains` 获取可用后缀。
- **浏览器托管会话**：`public_address`、token 型会话以及用户自带 API key 的邮箱会优先保存在当前浏览器，而不是依赖服务端进程内 `Map`。
- **最近邮箱历史**：浏览器会保留最近 8 个邮箱会话，支持快速切换与移除。
- **接管已有会话**：可直接输入已有邮箱地址，并配合 token 或 API key 把现有会话接管到当前浏览器。
- **用户自带 API key**：以 `inboxes` 为代表的 `api_key` provider 可以由访问者自己输入 API key，避免共用站长托管凭据。
- **自动收件箱刷新**：创建邮箱后，前端每 15 秒轮询一次消息列表，不是实时推送。
- **双视图阅读**：同一封邮件同时提供纯文本阅读区和 HTML iframe 预览区。
- **HTML 沙箱隔离**：HTML 正文通过 `iframe` 的 `sandbox` 模式展示，降低预览带来的隔离风险。
- **附件走 API 入口**：附件仍通过应用自己的 route handler 解析，但前端先取下载地址再打开，避免把浏览器托管凭据暴露到 URL 查询参数中。

## 架构说明

前端主工作区集中在 `src/components/tpmail/app-shell.tsx`。默认会优先选择 `duckmail`，前提是该 provider 已启用。用户在这个组件里完成 provider 选择、邮箱创建、最近邮箱切换、接管已有 token / API key 会话、消息轮询、单封邮件打开和附件下载入口访问。

后端主链路如下：

```text
src/app/api/**/route.ts
-> src/server/tpmail/service.ts
-> src/server/tpmail/providers/*.ts
```

其中：

- `src/app/api/**/route.ts` 负责 App Router 下的 Route Handlers
- `src/server/tpmail/service.ts` 负责 provider 聚合、参数校验、缓存与会话访问
- `src/server/tpmail/providers/*.ts` 负责各 provider 的适配实现
- `src/lib/tpmail/types.ts` 与 `src/lib/tpmail/errors.ts` 负责共享类型和错误响应契约

## 状态与运行边界

> [!WARNING]
> 当前实现已经拆成“服务端内存态”和“浏览器托管态”两类：provider 列表 / 域名缓存，以及仍需服务端代管的邮箱会话，保存在 `src/server/tpmail/store.ts` 的 `globalThis + Map` 中；`public_address`、token 型会话、用户自带 API key 的邮箱快照则优先保存在浏览器 `localStorage` 中。两者都不会落库，也都不适合跨实例共享。

- provider 列表缓存、域名缓存，以及仍需服务端托管的邮箱会话都在当前 Node 进程内存中，不会落库。
- 浏览器托管的邮箱快照、最近邮箱历史、以及用户自带的 API key 只保存在当前浏览器，不会自动同步到其他设备或浏览器配置文件。
- `/api/providers` 和 `/api/providers/[providerId]/domains` 会返回 `x-tpmail-cache` 响应头，用来标识缓存命中或未命中。
- 创建邮箱时，后端会校验 alias，只允许字母、数字、点、下划线和短横线。
- 如果请求里带了 domain，服务层会按 provider 可用域名做白名单检查；对于 `api_key` provider，会使用当前浏览器提供的 API key 参与校验。
- 附件下载不是静态文件服务，而是通过附件 route handler 解析出上游地址后再交给浏览器打开。
- 邮件 HTML 预览是沙箱 iframe，不应把这部分理解为可直接信任的渲染内容。
- token 型导入会话在浏览器里会显示为“未校验地址”，表示当前地址是用户手动输入的标签，上游是否与 token 真实绑定仍以 provider 的响应为准。

## 开发

这是一个标准的 Next 16 App Router 项目，样式层使用 Tailwind 4。Tailwind 通过 `postcss.config.mjs` 与 `src/app/globals.css` 接入，仓库里没有 `tailwind.config.*` 属于正常实现。

开发验证只使用以下命令：

```bash
npm run lint
npm run build
```

`next.config.ts` 开启了 `output: "standalone"`，因此构建产物按 Node 服务运行，不是静态导出站点。

## 部署

仓库自带容器化部署文件：

- `Dockerfile` 使用三阶段构建，最终从 `.next/standalone`、`.next/static` 和 `public` 组装运行镜像
- `compose.yaml` 提供本地容器启动方式，并从 `.env` 注入环境变量

最终运行语义是 **standalone Node 服务**。生产镜像在容器内通过 `node server.js` 启动，默认暴露 `3000` 端口。

如果你准备把它公开部署到 VPS，当前推荐模式是：

- 匿名 / 公共地址型 provider 直接由浏览器保存会话
- token 型 provider 由访问者自己在浏览器里持有 token
- `api_key` 型 provider 由访问者自己输入 API key，而不是共用站长环境变量

这样可以显著减少“访问者共用站长托管凭据”的情况，但浏览器托管的会话与 API key 仍属于当前访问者本地数据，不适合拿来做跨设备同步。

## API 概览

当前仓库包含 7 个 route handler，对应以下端点：

| 方法 | 端点 | 说明 |
| --- | --- | --- |
| `GET` | `/api/providers` | 返回 provider 描述列表，带 `x-tpmail-cache` 头 |
| `GET` | `/api/providers/:providerId/domains` | 返回指定 provider 的可用域名列表，带 `x-tpmail-cache` 头 |
| `POST` | `/api/mailboxes` | 创建邮箱会话；对 `api_key` provider 可携带当前浏览器输入的 `apiKey` |
| `GET` | `/api/mailboxes/:mailboxId` | 读取邮箱会话公开信息 |
| `GET` | `/api/mailboxes/:mailboxId/messages` | 拉取邮箱消息列表 |
| `GET` | `/api/mailboxes/:mailboxId/messages/:messageId` | 拉取单封邮件详情 |
| `GET` | `/api/mailboxes/:mailboxId/messages/:messageId/attachments/:attachmentId` | 获取附件下载入口；前端会先取下载地址，再由浏览器打开上游 URL |

错误响应由 `src/lib/tpmail/errors.ts` 统一整理，返回体包含 `error.code`、`error.message`、`error.status`、`error.retryable` 等字段。

对于浏览器托管的邮箱，会话快照通过请求头回传到 mailbox 相关路由，不会再把 token / API key 放到 URL 查询参数中。

## 运行注意事项 / 已知限制

- 首页 provider 数据来自服务端 `listProviders()` 直调，不要把首屏行为理解成前端先请求 `/api/providers`。
- 收件箱更新依赖 15 秒轮询，不包含实时推送、WebSocket 或浏览器通知机制。
- provider 的启用状态可能随代码变化而变化，查阅状态时应直接看各 provider 适配器的 `descriptor.enabled`。
- 仍由服务端代管的邮箱会话、provider 缓存，在服务重启后会失效；浏览器托管的邮箱快照则只在当前浏览器里保留。
- 多实例部署下，当前实现不提供共享会话与共享缓存的一致性保证；浏览器托管的邮箱历史也不会在实例之间同步。
- “最近邮箱列表”和“接管已有会话”都属于浏览器本地能力，换设备、换浏览器或清空本地存储后需要重新导入。
- token 型导入会话会先做一次真实拉取校验，再写入最近邮箱列表；若后续返回 400 / 401 / 404 / 410，该会话会从本地列表中移除。
- 附件能力是否可用，取决于对应 provider 是否实现附件 URL 解析能力。

## 代码定位

如果你准备继续开发，通常可以从下面这些入口开始：

- `src/app/page.tsx`，首页服务端注入 provider
- `src/components/tpmail/app-shell.tsx`，前端主工作区
- `src/app/api/**/route.ts`，API 路由入口
- `src/server/tpmail/service.ts`，服务编排与校验
- `src/server/tpmail/store.ts`，进程内会话与缓存
- `src/server/tpmail/providers/*.ts`，各 provider 适配器
- `src/lib/tpmail/types.ts`，共享类型契约

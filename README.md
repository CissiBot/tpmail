# TPMail Aggregator

一个可自部署的临时邮箱聚合站首版：前端只对接统一 API，后端负责屏蔽不同 provider 的接入差异。当前实现重点覆盖：**选择 provider、生成地址、轮询收件箱、阅读邮件、有限的附件跳转下载**，并预留了对需要密钥的商业 provider 的后端托管接入位。

## 当前能力

- 已启用真实接入：`Catchmail`、`Maildrop`、`TempMail.lol`
- 已预留但默认禁用：`DuckMail`、`Temp-Mail.io`
- 统一 API：`/api/providers`、`/api/mailboxes`、`/api/mailboxes/:id/messages`
- 单页主工作区：provider 选择、地址控制、收件箱列表、邮件详情
- HTML 邮件预览通过沙箱 iframe 隔离不可信内容
- 部署方式：本地 Node、Docker、Podman / Compose

## 架构说明

代码按职责拆为 4 层：

- `src/app`：页面和 Route Handlers
- `src/components/tpmail`：前端工作区组件
- `src/server/tpmail`：provider adapters、服务层、会话存储
- `src/lib/tpmail`：共享类型、错误模型、工具函数

当前会话存储使用**内存 Map**，适合首版演示和单实例部署；如果后续要做多实例或持久会话，可以把 `src/server/tpmail/store.ts` 换成 Redis 或数据库实现，而不影响前端和 provider 层。

## 本地启动

```bash
cp .env.example .env
npm install
npm run dev
```

打开 <http://localhost:3000>。

## 容器启动

### Docker Compose / Podman Compose

```bash
cp .env.example .env
docker compose up --build
```

如果你使用 Podman：

```bash
cp .env.example .env
podman compose up --build
```

## Provider 状态

### Catchmail
- 无鉴权公共接口
- 适合首版匿名收件箱体验
- 支持附件下载跳转

### Maildrop
- GraphQL 接口
- 有 greylisting、24 小时清理和 10 封上限
- 当前首版只接收基础列表与详情，不承诺附件能力

### TempMail.lol
- 基于 inbox token
- 当前首版用统一后端会话封装 token
- 自定义域名与 webhook 未开放到前端
- 在部分网络区域可能被上游限制访问

### DuckMail / Temp-Mail.io
- 需要后端托管密钥或账号凭据
- 当前作为能力占位，不在演示版启用

## 统一 API 示例

### 读取 provider 列表

```bash
curl http://localhost:3000/api/providers
```

### 创建 Catchmail 邮箱

```bash
curl -X POST http://localhost:3000/api/mailboxes \
  -H "Content-Type: application/json" \
  -d '{"provider":"catchmail"}'
```

### 查询收件箱消息

```bash
curl http://localhost:3000/api/mailboxes/<mailbox-id>/messages
```

## 后续扩展位

这个首版故意没有加入登录、数据库、Webhook 管理、已读同步等附加能力。下一步如果继续扩展，优先级应该是：

1. 把内存会话换成持久化存储
2. 为 L3 provider 加入后端凭据托管
3. 增加 provider/domain 策略与自动降级

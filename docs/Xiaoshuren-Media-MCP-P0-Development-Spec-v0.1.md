# Xiaoshuren Media MCP + Media Orchestrator P0 开发规范

- **版本**：v0.1
- **日期**：2026-10-04
- **状态**：P0开发基线候选
- **首发客户端**：Claude Remote MCP
- **未来客户端**：ChatGPT、Hermes、AstrBot、USVDS、MediaGo
- **文档用途**：P0 需求冻结、架构设计、接口契约、数据模型、安全基线、测试 Gate 与实施计划

---

## 0. 决策摘要

P0 的目标不是复制 Higgsfield 的全部产品能力，而是建立一个稳定的 AI 媒体生成基础设施，使 Claude 可以通过标准 Remote MCP 可靠调用第三方图像/视频 API，并为未来多客户端、多 Provider 扩展保留稳定边界。

冻结原则：

1. **薄 MCP Adapter + 稳定 Media Core + Provider Adapter**。任何客户端不得直接调用第三方 Provider。
2. Claude 是首发客户端，但 Media Core 内不得出现 Claude 专属领域模型。
3. P0 重点开放图像、视频；音频只做架构预留，生产开放进入 P1。
4. Remote MCP 使用公网 HTTPS Streamable HTTP；认证采用 OAuth Authorization Code + PKCE。
5. P0 不依赖 MCP draft Tasks、resource subscription、sampling，也不依赖分钟级长连接。
6. 生成任务全部异步：`generate_*` 快速返回内部 `job_id`；Provider polling/webhook/reconciliation 在后端完成。
7. Provider 凭据只存在服务端 Secret Manager；MCP OAuth Token 禁止透传 Provider。
8. Job、Asset、Quote、Workspace 均执行 tenant/subject/workspace 对象级授权；ID 本身不是授权凭据。
9. P0 使用**预授权 Workspace 预算**，不是消费者支付系统；Quote 用于冻结请求、透明展示成本、预算预占。
10. 所有写 Tool 必须带 `idempotency_key`。
11. 不假定 Claude 聊天附件自动可被 MCP 读取；附件能力必须通过 Claude E2E Gate 实测。
12. Provider 产物必须归档为自家 Asset；不得把长期 Provider URL 或大体积 Base64 当最终结果。
13. PostgreSQL 是业务事实源；对象存储保存二进制；Queue/Outbox 负责异步执行。
14. Provider 提交结果未知时进入 `unknown/reconciling`，禁止盲目重复提交。
15. 任一 P0 Gate 未通过，不进入生产。

---

## 1. P0 目标与范围

### 1.1 核心目标

P0 必须完成以下闭环：

```text
Claude
  → OAuth
  → Remote MCP Tool
  → Media Core
  → Quote / Budget
  → Job
  → Provider Adapter
  → 第三方图像/视频 API
  → Webhook / Polling
  → Asset Ingest
  → 私有对象存储
  → job_get / asset_get
  → Claude
```

P0 的最小生产能力：

- Claude 可发现可用模型及模型限制。
- Claude 可导入/上传参考素材，前提是所用路径通过 E2E Gate。
- Claude 可获取一次生成请求的成本 Quote。
- Claude 可创建图像和视频 Job。
- Job 提交后 MCP 立即返回，不等待媒体生成完成。
- Claude 可查询 Job 状态、取消可取消 Job。
- 生成结果进入自家 Asset Library，并按需返回短期签名 URL。
- 至少接入 1–2 个真实 Provider。
- 至少验证一条 webhook 主导链路和一条 polling 主导链路。
- Provider 超时、重复 webhook、Worker 重启均不会造成重复收费或不可解释的重复生成。
- 全链路可按 `request_id → job_id → provider_execution_id → asset_id` 追踪。

### 1.2 P0 非目标

P0 明确不做：

- Higgsfield 全功能复制。
- 音频生产开放、语音克隆、音乐生成。
- 自动跨 Provider failover。
- 智能模型路由、质量自动评分、成本最优路由。
- 多步骤 DAG、剧本/镜头生产流水线。
- 批量生成中心。
- 完整钱包、充值、发票、退款、税务、分账。
- 消费者级支付确认系统。
- 依赖 MCP draft Tasks。
- `jobs_wait` / `jobs_poll` 分钟级长轮询。
- 将大图/视频直接 Base64 返回给 Claude。
- 默认认为 Claude 聊天附件可自动传给 MCP。
- 公开对象存储桶。
- 客户端自带任意 Provider API Key 直通。

### 1.3 P1 候选范围

- 音频 Provider 和音频 Tool。
- 独立 `confirmation_token` / 消费者级费用确认。
- Batch。
- Preset / Workflow。
- 多 Provider 路由、显式 failover。
- Media Library 搜索、标签、收藏、衍生关系。
- ChatGPT/Hermes/AstrBot/USVDS/MediaGo Client Adapter。
- 团队 Workspace、高级 RBAC/ABAC。
- Provider BYOK。
- 语义搜索与资产向量索引。
- 成本优化和供应商健康度自动路由。

---

## 2. 总体架构

```text
┌──────────────────────── Client Layer ────────────────────────┐
│ Claude Remote MCP (P0)                                      │
│ ChatGPT / Hermes / AstrBot / USVDS / MediaGo (P1+)          │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ Thin MCP / Client Adapter                                   │
│ - Streamable HTTP                                           │
│ - OAuth context                                             │
│ - tools/list + tools/call                                   │
│ - JSON Schema validation                                    │
│ - Error mapping                                             │
└────────────────────────────┬─────────────────────────────────┘
                             │ Internal Command / Query API
                             ▼
┌──────────────────── Media Core / Orchestrator ──────────────┐
│ Model Catalog                                               │
│ Workspace + Authorization                                   │
│ Quote + Budget Reservation                                  │
│ Job + State Machine                                         │
│ ProviderExecution                                           │
│ Asset + Upload                                               │
│ Audit                                                       │
│ Outbox + WebhookEvent                                       │
│ Reconciliation                                              │
└───────────────┬──────────────────────┬───────────────────────┘
                │                      │
                ▼                      ▼
         Queue / Workers         PostgreSQL
                │
                ▼
┌──────────────────── Provider Adapter Layer ─────────────────┐
│ Provider A (webhook)                                        │
│ Provider B (polling)                                        │
│ Future Audio Provider                                       │
└────────────────────────────┬─────────────────────────────────┘
                             ▼
                      Third-party APIs

                ┌──────────────────────┐
                │ S3 / R2 Asset Store  │
                └──────────────────────┘
```

### 2.1 强制边界

- MCP Server 不直接依赖 Provider SDK。
- Media Core 不依赖 MCP SDK、Claude SDK。
- Provider Adapter 不处理 Workspace 授权、预算、Quote。
- Provider Adapter 不直接修改 Job 表；它返回观察结果，由 Job Service 做状态迁移。
- Worker 不能绕过 Media Core 直接修改终态。
- 客户端不得提交任意 Provider 请求体。
- 数据库是 Job/Quote/Asset 状态唯一事实源。
- Queue 只负责投递，不是事实源。
- Provider 状态是外部观察，不是内部事实源。

---

## 3. 建议技术栈与仓库结构

### 3.1 P0 参考技术栈

- Runtime：当前受支持 Node.js LTS
- Language：TypeScript
- Package Manager：pnpm
- Monorepo：pnpm workspace
- HTTP API：Fastify
- MCP：官方 Model Context Protocol TypeScript SDK
- Database：PostgreSQL
- Queue：Redis + BullMQ（或等价托管队列；接口需可替换）
- Object Storage：S3-compatible / Cloudflare R2
- Schema：JSON Schema + TypeScript 类型生成/校验
- Observability：OpenTelemetry + structured logging + metrics
- Secrets：部署平台 Secret Manager / Vault
- Deploy：容器化；MCP/API/Worker 独立部署和扩缩容

### 3.2 仓库结构

```text
apps/
  mcp-server/
    src/
      transport/
      oauth/
      tools/
      schemas/
      error-mapping/
  api/
    src/
      assets/
      jobs/
      quotes/
      workspaces/
      webhooks/

packages/
  media-core/
    src/
      catalog/
      workspace/
      authorization/
      quotes/
      jobs/
      assets/
      audit/
      ports/
  contracts/
    src/
      mcp/
      domain/
      events/
      errors/
  provider-adapters/
    src/
      provider-a/
      provider-b/
      shared/
  persistence/
    src/
      postgres/
      repositories/
      migrations/
      outbox/
  workers/
    src/
      submitter/
      poller/
      reconciler/
      webhook-processor/
      asset-ingester/
  security/
    src/
      ssrf/
      upload-validation/
      redaction/
      secrets/
  observability/
    src/
      tracing/
      metrics/
      logging/

infra/
  docker/
  terraform/
  monitoring/

tests/
  unit/
  integration/
  e2e/
  security/
  load/
  recovery/
```

依赖方向：

```text
MCP Server / API / Workers
           ↓
       Media Core
           ↓
    Ports / Contracts
           ↓
Persistence / Provider Adapters / Queue / Storage
```

---

## 4. Claude Remote MCP 与 OAuth

### 4.1 Remote MCP

生产要求：

- 公网可访问 HTTPS。
- Streamable HTTP。
- 不依赖本地 stdio。
- MCP Tool 返回小型结构化结果。
- 不依赖分钟级 MCP 连接保持。
- 不依赖最新 draft extension。

### 4.2 OAuth

采用 Authorization Code + PKCE。

服务端必须校验：

- JWT/Token 签名
- `iss`
- `exp` / `nbf`
- `aud`
- `resource`
- `scope`
- `sub`
- Client / tenant 映射

推荐 scopes：

```text
media.models.read
media.assets.read
media.assets.write
media.quotes.create
media.generate.image
media.generate.video
media.jobs.read
media.jobs.cancel
```

OAuth Token 只用于：

```text
Claude → Xiaoshuren MCP
```

禁止：

```text
Claude Token → Third-party Provider
```

Provider 使用完全独立的服务端凭据。

---

## 5. Workspace 与对象级授权

### 5.1 身份模型

```ts
type AuthContext = {
  tenantId: string;
  subjectId: string;
  clientId: string;
  scopes: string[];
  defaultWorkspaceId?: string;
};
```

### 5.2 Workspace 输入规则

Tool 可以接受可选 `workspace_id`，用于用户确实拥有多个 Workspace 的情况。

服务端规则：

1. 未传：使用 Token 映射的默认 Workspace。
2. 已传：必须查询当前 `subjectId` 是否为该 Workspace 成员。
3. 不接受客户端传入 `tenant_id`。
4. 任何查询都必须同时约束 `tenant_id + workspace_id`。
5. Job/Asset/Quote ID 不能作为授权依据。
6. 对无权限资源，返回统一不可见语义，避免 ID 枚举。

---

## 6. P0 MCP Tools

P0 固定 10 个 Tools：

| Tool | 类型 | Scope | 外部副作用 |
|---|---|---|---|
| `models_list` | Read | `media.models.read` | 无 |
| `models_get` | Read | `media.models.read` | 无 |
| `asset_create_upload` | Write | `media.assets.write` | 创建 Asset/Upload |
| `asset_confirm` | Write | `media.assets.write` | 完成上传、触发处理 |
| `asset_get` | Read | `media.assets.read` | 无 |
| `quote_create` | Write | `media.quotes.create` | 创建 Quote、预算预占 |
| `generate_image` | Write | `media.generate.image` | 创建付费 Job |
| `generate_video` | Write | `media.generate.video` | 创建付费 Job |
| `job_get` | Read | `media.jobs.read` | 无 |
| `job_cancel` | Write | `media.jobs.cancel` | 取消请求 |

### 6.1 写 Tool 通用字段

**所有 Write Tool 的 input schema 必须包含：**

```ts
type WriteToolBase = {
  idempotency_key: string; // 16..128 chars
  workspace_id?: string;
};
```

规则：

- 同 subject + tool + idempotency_key + 相同 request hash：返回首次语义结果。
- 同 key + 不同 request hash：`IDEMPOTENCY_CONFLICT`。
- 幂等记录必须持久化，不只放缓存。
- Provider 支持 idempotency 时，使用内部派生的 `provider_request_key` 透传。

---

## 7. Tool 摘要 Schema

以下为领域摘要；实际 MCP JSON Schema 必须 `additionalProperties: false`。

### 7.1 models_list

```ts
type ModelsListInput = {
  capability?: "image_generation" | "video_generation";
  cursor?: string;
  limit?: number;
};

type ModelsListOutput = {
  items: Array<{
    public_model_id: string;
    display_name: string;
    capability: "image_generation" | "video_generation";
    availability: "available" | "disabled" | "maintenance";
    pricing_rule_version: string;
  }>;
  next_cursor?: string;
};
```

### 7.2 models_get

```ts
type ModelsGetInput = {
  public_model_id: string;
};

type ModelsGetOutput = {
  public_model_id: string;
  display_name: string;
  capability: "image_generation" | "video_generation";
  input_schema: Record<string, unknown>;
  pricing_rule_version: string;
  availability: string;
  limits: {
    max_prompt_chars?: number;
    max_input_assets?: number;
    max_duration_seconds?: number;
    supported_aspect_ratios?: string[];
    supported_resolutions?: string[];
  };
};
```

### 7.3 asset_create_upload

```ts
type AssetCreateUploadInput = WriteToolBase & {
  source:
    | {
        kind: "controlled_url_import";
        url: string;
      }
    | {
        kind: "inline_base64";
        filename: string;
        mime_type: string;
        base64: string;
      }
    | {
        kind: "upload_session";
        filename: string;
        mime_type: string;
        byte_size: number;
      };
};

type AssetCreateUploadOutput = {
  asset_id: string;
  status: "pending_upload" | "pending_import" | "processing";
  upload?: {
    mode: "single_put" | "multipart";
    put_url?: string;
    parts?: Array<{ part_number: number; url: string }>;
    expires_at: string;
  };
};
```

### 7.4 asset_confirm

```ts
type AssetConfirmInput = WriteToolBase & {
  asset_id: string;
  upload_receipt?: {
    etags?: Array<{ part_number: number; etag: string }>;
  };
};

type AssetConfirmOutput = {
  asset_id: string;
  status: "processing" | "ready" | "rejected";
  rejection_code?: string;
};
```

### 7.5 asset_get

```ts
type AssetGetInput = {
  workspace_id?: string;
  asset_id: string;
  include_access_url?: boolean;
};

type AssetGetOutput = {
  asset_id: string;
  kind: "input" | "generated_image" | "generated_video";
  status: "pending_upload" | "processing" | "ready" | "rejected" | "deleted";
  mime_type?: string;
  byte_size?: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  access_url?: string;
  access_url_expires_at?: string;
};
```

### 7.6 quote_create

P0 的 Quote **不是消费者支付订单**，而是预授权 Workspace 中的成本透明与预算预占。

```ts
type QuoteCreateInput = WriteToolBase & {
  public_model_id: string;
  request: Record<string, unknown>;
};

type QuoteCreateOutput = {
  quote_id: string;
  request_hash: string;
  max_charge: {
    currency: string;
    amount_minor: number;
  };
  expires_at: string;
  pricing_rule_version: string;
  spend_mode: "preauthorized_workspace_budget";
  confirmation_required: true;
};
```

### 7.7 generate_image / generate_video

```ts
type GenerateInput = WriteToolBase & {
  quote_id: string;
  request_hash: string;
  confirm_quote: true;
  request: Record<string, unknown>;
};

type GenerateOutput = {
  job_id: string;
  status: "queued";
  quote_id: string;
  request_hash: string;
};
```

服务端必须重新：

- 校验 Quote 未过期。
- 校验 Quote 属于当前 tenant/subject/workspace。
- 规范化 `request` 并重新计算 hash。
- 校验 `request_hash` 完全一致。
- 校验 Workspace 的 `spend_mode=preauthorized_workspace_budget`。
- 记录 `confirm_quote=true` 的主体和时间。

**P0 不把该字段宣称为消费者支付授权。** 对公众收费场景必须进入 P1 独立 confirmation_token / payment authorization 设计。

### 7.8 job_get

```ts
type JobGetInput = {
  workspace_id?: string;
  job_id: string;
};

type JobGetOutput = {
  job_id: string;
  kind: "image_generation" | "video_generation";
  status:
    | "queued"
    | "submitting"
    | "submitted"
    | "running"
    | "unknown"
    | "reconciling"
    | "cancel_requested"
    | "cancelled"
    | "succeeded"
    | "failed";
  output_asset_ids: string[];
  retry_after_seconds?: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  created_at: string;
  updated_at: string;
};
```

### 7.9 job_cancel

```ts
type JobCancelInput = WriteToolBase & {
  job_id: string;
};

type JobCancelOutput = {
  job_id: string;
  status:
    | "cancel_requested"
    | "cancelled"
    | "succeeded"
    | "failed";
};
```

---

## 8. Claude 附件与 Asset 上传

### 8.1 不允许的假设

禁止把以下行为写成已支持：

> 用户把图片拖进 Claude 对话框，因此 Remote MCP 一定能得到文件路径、字节或下载 URL。

是否存在可用附件桥接必须实测。

### 8.2 P0 三种输入路径

#### A. Controlled HTTPS URL Import

适合可访问的已授权 HTTPS 资源。

安全要求：

- HTTPS only。
- SSRF 检查。
- DNS/IP 检查。
- 每次 redirect 重校验。
- 禁止私网、loopback、link-local、metadata、保留地址。
- 限制下载大小、时间、重定向次数。
- 校验 MIME + magic bytes。

#### B. Inline Base64

仅小文件。

要求：

- 设置严格字节上限。
- 解码前后检查大小。
- 只用于图片等小素材。
- 视频不使用 inline Base64。

#### C. Upload Session

服务端返回：

- single PUT presigned URL，或
- multipart upload URLs。

适合有上传能力的 Client Adapter / 外部上传页面。

### 8.3 Claude Attachment Bridge E2E Gate

P0-04 必须真实验证 Claude：

- 能否把聊天附件以 Tool 参数可消费形式传入。
- 能否执行或配合 presigned upload。
- 是否只能传可访问 URL。
- 图片/视频分别有什么限制。

结果处理：

- **验证成功**：将成功路径写入 Claude 支持矩阵。
- **验证失败**：Claude P0 只开放受控 URL import，或跳转到已认证外部上传入口。
- 不得用理论推断代替 E2E 结果。

---

## 9. Quote、预算与费用边界

### 9.1 P0 模式

P0 仅面向**内部/受控 Workspace 的预授权预算**：

```text
Workspace Budget
  → quote_create
  → reserve max charge
  → explicit confirm_quote
  → create Job
  → Provider execution
  → settle / release reservation
```

P0 不建设：

- 信用卡付款。
- 消费者购买确认。
- 钱包充值。
- 退款系统。
- 税务/发票。

### 9.2 Quote 冻结内容

`request_hash` 至少覆盖：

- public_model_id
- prompt / negative prompt
- input asset IDs + 顺序
- 时长
- 分辨率
- aspect ratio
- output count
- quality tier
- 所有影响价格/输出的参数
- pricing_rule_version
- workspace

### 9.3 预算账务语义

建议使用不可变 Ledger：

```text
reserve
capture
release
adjustment
```

P0 可以不暴露完整 Billing API，但数据库必须支持：

- Quote Reservation
- Capture
- Release
- 审计追踪

---

## 10. Job 状态机

```text
queued
  ↓
submitting
  ↓
submitted
  ↓
running
  ↓
succeeded | failed

submitting
  ↓
unknown
  ↓
reconciling
  ├→ submitted
  ├→ running
  ├→ succeeded
  └→ failed

queued/submitting/submitted/running/unknown/reconciling
  ↓
cancel_requested
  ├→ cancelled
  ├→ succeeded
  └→ failed
```

### 10.1 关键语义

- `queued`：Job 与 Outbox 已提交。
- `submitting`：正在请求 Provider。
- `submitted`：Provider 已确认接单。
- `running`：Provider 明确运行中。
- `unknown`：提交结果不可确定。
- `reconciling`：正在外部对账。
- `cancel_requested`：取消请求已记录，但外部结果尚未确认。
- `succeeded/failed/cancelled`：终态。

**任何 `unknown` 状态禁止盲目重新 submit。**

---

## 11. Provider Adapter

```ts
type ProviderExecutionContext = {
  tenantId: string;
  workspaceId: string;
  jobId: string;
  providerExecutionId: string;
  providerRequestKey: string;
  callbackUrl?: string;
};

type ProviderSubmitResult = {
  providerJobId?: string;
  status: "submitted" | "running" | "unknown";
};

type ProviderStatusResult = {
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "unknown";
  outputs?: Array<{
    url: string;
    mimeType?: string;
  }>;
  error?: {
    providerCode?: string;
    message: string;
    retryable: boolean;
  };
};

interface ProviderAdapter {
  submit(
    ctx: ProviderExecutionContext,
    request: Record<string, unknown>
  ): Promise<ProviderSubmitResult>;

  getStatus(
    ctx: ProviderExecutionContext,
    providerJobId: string
  ): Promise<ProviderStatusResult>;

  cancel?(
    ctx: ProviderExecutionContext,
    providerJobId: string
  ): Promise<ProviderStatusResult>;

  verifyWebhook?(
    headers: Record<string, string>,
    rawBody: Uint8Array
  ): Promise<{
    valid: boolean;
    eventId?: string;
  }>;

  normalizeError(error: unknown): {
    code: string;
    message: string;
    retryable: boolean;
    providerCode?: string;
  };
}
```

### 11.1 Provider 规则

- Provider Adapter 不写 Job 终态。
- Provider Adapter 不读取 Workspace 预算。
- Provider Adapter 不决定用户权限。
- Provider 原始状态必须保存用于审计，但只通过标准状态暴露上层。
- Provider 支持幂等时，必须使用稳定 `providerRequestKey`。
- Provider 不支持幂等时，网络超时进入 UNKNOWN/Reconciliation。
- P0 不允许自动跨 Provider 重投。

---

## 12. Model Catalog

每个版本化 Model Entry：

```ts
type ModelCatalogEntry = {
  publicModelId: string;
  version: string;
  providerId: string;
  providerModelId: string;
  capability: "image_generation" | "video_generation" | "audio_generation";
  inputSchema: Record<string, unknown>;
  pricingRuleVersion: string;
  availability: "available" | "disabled" | "maintenance";
  limits: Record<string, unknown>;
  features: {
    supportsWebhook: boolean;
    supportsCancel: boolean;
    supportsProviderIdempotency: boolean;
  };
};
```

P0 中音频条目可以存在于内部 Catalog，但 `models_list` 对 Claude P0 默认不得返回 `audio_generation`。

---

## 13. 核心数据表

### 13.1 workspaces

```text
id
tenant_id
name
status
budget_policy_id
spend_mode
created_at
updated_at
```

### 13.2 model_catalog

```text
id
public_model_id
version
provider_id
provider_model_id
capability
input_schema_json
pricing_rule_version
availability
features_json
effective_from
effective_to
created_at
updated_at
```

### 13.3 quotes

```text
id
tenant_id
subject_id
workspace_id
public_model_id
request_hash
normalized_request_json
pricing_rule_version
max_charge_currency
max_charge_amount_minor
reservation_id
confirmation_state
expires_at
status
created_at
updated_at
```

### 13.4 jobs

```text
id
tenant_id
subject_id
workspace_id
quote_id
kind
public_model_id
request_hash
frozen_request_json
status
cancellation_requested_at
terminal_error_code
terminal_error_message_redacted
created_at
updated_at
completed_at
version
```

### 13.5 provider_executions

```text
id
job_id
provider_id
provider_model_id
provider_request_key
provider_job_id
status
submission_attempts
last_provider_status_at
raw_reference_encrypted
last_error_code
last_error_redacted
created_at
updated_at
```

### 13.6 assets

```text
id
tenant_id
workspace_id
source_job_id
kind
status
storage_bucket
storage_key
sha256
mime_type
byte_size
width
height
duration_ms
metadata_json
created_at
updated_at
deleted_at
```

### 13.7 idempotency_records

```text
id
tenant_id
subject_id
tool_name
idempotency_key
request_hash
response_snapshot_json
resource_type
resource_id
expires_at
created_at
```

唯一约束：

```text
tenant_id + subject_id + tool_name + idempotency_key
```

### 13.8 audit_logs

```text
id
tenant_id
subject_id
workspace_id
action
target_type
target_id
request_id
metadata_redacted_json
created_at
```

### 13.9 outbox_events

```text
id
aggregate_type
aggregate_id
event_type
payload_json
available_at
processed_at
attempt_count
created_at
```

### 13.10 webhook_events

```text
id
provider_id
provider_event_id
signature_valid
received_at
payload_encrypted
processed_at
processing_result
```

唯一约束：

```text
provider_id + provider_event_id
```

若 Provider 无事件 ID，使用经过规范化的 payload hash 去重。

---

## 14. 核心事务边界

### 14.1 quote_create

同一个 PostgreSQL transaction：

1. 验证 Workspace 权限。
2. 验证 Asset 权限。
3. 校验 Catalog Schema。
4. 规范化 request。
5. 生成 request_hash。
6. 计算 max charge。
7. 检查预算。
8. 建 Quote。
9. Reserve Budget。
10. 写 Audit。

### 14.2 generate_*

同一个 transaction：

1. 查 Idempotency Record。
2. 验证 Quote。
3. 校验 request hash。
4. 验证 confirm_quote。
5. 验证 Workspace spend policy。
6. 建 Job。
7. 建 ProviderExecution。
8. 写 Outbox。
9. 写 Audit。
10. 写 Idempotency Record。

**Provider HTTP 调用不得放在数据库 transaction 内。**

### 14.3 Job 完成

产物成功下载、校验并写对象存储后，在数据库 transaction 中：

1. 创建 Asset。
2. 将 Asset 关联 Job。
3. Job → succeeded。
4. Capture / Release reservation。
5. 写 Audit。
6. 写 completion Outbox event。

对象存储失败时，不得把 Job 标记为 succeeded。

---

## 15. Queue、Webhook、Polling、Reconciliation

### 15.1 Queue

至少支持：

- delayed retry
- at-least-once delivery
- concurrency
- dead-letter / failed queue
- retry count
- metrics

### 15.2 Webhook

Webhook 入口必须：

- 获取 raw body。
- 验签。
- 校验 timestamp。
- 防 replay。
- 去重 event ID。
- 快速持久化并返回。
- 后续处理进入 Queue。
- 不在 HTTP callback 内做耗时媒体下载。

### 15.3 Polling

用于：

- 无 webhook Provider。
- webhook 丢失补偿。
- 非终态超时检查。
- unknown reconciliation。

示例退避：

```text
5s → 15s → 30s → 60s → 5min
```

实际策略由 Provider Profile 配置。

---

## 16. Asset Ingest

Provider 成功不等于内部 Job 已成功。

必须执行：

1. 获取 Provider output。
2. 校验允许的 HTTPS 来源。
3. 下载到隔离区。
4. 校验 MIME、magic bytes、size。
5. 媒体 probe。
6. 可选恶意文件扫描。
7. 计算 SHA-256。
8. 写入私有对象存储。
9. 写 Asset metadata。
10. Job 才能进入 succeeded。

返回给客户端：

```text
asset_id
+ optional short-lived signed URL
```

不返回长期 Provider URL。

---

## 17. 安全基线

### 17.1 必须覆盖

- OAuth PKCE。
- audience/resource/scope。
- Provider Secret 隔离。
- BOLA / IDOR。
- SSRF。
- 恶意上传。
- 文件 MIME 欺骗。
- webhook 签名和 replay。
- Idempotency。
- Rate Limit。
- Budget Limit。
- WAF。
- Log Redaction。
- 短期签名 URL。
- 租户级数据隔离。

### 17.2 SSRF

URL Import：

- HTTPS only。
- 禁止 localhost。
- 禁止 RFC1918/private。
- 禁止 link-local。
- 禁止 cloud metadata。
- 禁止保留 IP。
- 每次 redirect 重新解析和验证。
- 限制 redirect count。
- 限制 response size。
- 限制 duration。
- 经过 egress policy。

### 17.3 日志脱敏

禁止记录：

- OAuth Token。
- Provider Key。
- Authorization Header。
- Presigned URL 完整 query。
- Secret Manager 内容。
- Provider 原始凭据。
- 用户敏感媒体内容。

---

## 18. 错误码

| Code | 含义 |
|---|---|
| `UNAUTHENTICATED` | OAuth 无效 |
| `INSUFFICIENT_SCOPE` | Scope 不足 |
| `FORBIDDEN` | 对象权限不足 |
| `NOT_FOUND` | 资源不可见或不存在 |
| `VALIDATION_ERROR` | Schema/业务参数错误 |
| `IDEMPOTENCY_CONFLICT` | 同 key 不同请求 |
| `QUOTE_EXPIRED` | Quote 过期 |
| `QUOTE_MISMATCH` | Quote 与请求不一致 |
| `CONFIRMATION_REQUIRED` | 缺少确认 |
| `BUDGET_EXCEEDED` | 预算不足 |
| `ASSET_NOT_READY` | Asset 未可用 |
| `ASSET_REJECTED` | Asset 拒绝 |
| `UNSAFE_SOURCE_URL` | URL Import 安全拒绝 |
| `MODEL_UNAVAILABLE` | 模型不可用 |
| `JOB_NOT_CANCELLABLE` | 不能取消 |
| `PROVIDER_TEMPORARY_ERROR` | Provider 暂时故障 |
| `PROVIDER_SUBMISSION_UNKNOWN` | 提交结果未知 |
| `RATE_LIMITED` | 限流 |
| `INTERNAL_ERROR` | 内部错误 |

业务错误结果应包含：

```ts
type ErrorResult = {
  ok: false;
  request_id: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retry_after_seconds?: number;
  };
};
```

---

## 19. 可观测性

必须使用：

- Structured Logs
- OpenTelemetry Trace
- Metrics
- Alerting

关键关联 ID：

```text
request_id
tenant_id
subject_id
workspace_id
quote_id
job_id
provider_execution_id
asset_id
```

关键指标：

- MCP tool P50/P95/P99。
- Tool error rate。
- OAuth reject rate。
- Quote create / expire / reject。
- Budget reject。
- Job status count。
- Job success rate。
- Job state duration。
- unknown rate。
- reconciliation success rate。
- Provider request latency/error。
- webhook verify failure。
- queue depth / delay。
- dead-letter count。
- asset ingest failure。
- SSRF reject。
- unauthorized object access reject。
- estimated vs actual cost delta。

---

## 20. P0 开发阶段

### P0-01：领域、数据库、Fake Provider

交付：

- Monorepo skeleton。
- Contracts。
- PostgreSQL migrations。
- Workspace / Catalog / Quote / Job / ProviderExecution / Asset / Audit / Outbox。
- 状态机。
- Idempotency。
- Fake Provider。
- Unit + Core Integration。

Gate：

- 非法状态迁移失败。
- 同 key 不同请求冲突。
- tenant/workspace 越权失败。
- Outbox 与 Job 原子落库。
- Fake Provider 可演示成功、失败、UNKNOWN→RECONCILING。

### P0-02：真实 Provider、Job、Asset

交付：

- 1–2 个 Provider。
- Webhook Processor。
- Poller。
- Reconciler。
- Asset Ingester。
- S3/R2。
- Presigned upload。
- URL import。
- Secret Manager。

Gate：

- Provider Key 不出服务器。
- Provider timeout 不盲重试。
- webhook replay/duplicate 安全。
- 图像真实链路成功。
- 视频真实链路成功。
- Provider output 成功归档 Asset。

### P0-03：MCP + OAuth

交付：

- Streamable HTTP MCP。
- OAuth Code + PKCE。
- 固定 10 Tools。
- Tool JSON Schemas。
- Tool Error Mapping。
- MCP Audit。
- MCP Rate Limit。

Gate：

- OAuth aud/resource/scope/sub 校验。
- Token 不下传 Provider。
- 所有 Write Tool 有 idempotency_key。
- Quote 无法被绕过。
- 对象权限测试通过。

### P0-04：Claude E2E

交付：

- Claude Remote MCP 实际连接。
- 登录授权。
- 完整链路：

```text
models_list
→ models_get
→ asset path (if needed)
→ quote_create
→ generate_image/video
→ job_get
→ asset_get
```

- Claude Attachment Bridge Gate 报告。
- Fallback 上传方案。

Gate：

- Claude 真实环境生图成功。
- Claude 真实环境生视频成功。
- Job 查询正常。
- Asset 访问正常。
- Quote/预算/审计可追溯。
- 附件路径有实测结论，不允许“理论支持”。

### P0-05：稳定性、安全、上线

交付：

- Dashboard。
- Alerts。
- Runbook。
- Security report。
- Load report。
- Recovery report。
- Key rotation procedure。
- Rollback plan。

Gate：

- Unit/Integration/E2E/Security/Load/Recovery 全部通过。
- 无高危 BOLA/IDOR。
- 无高危 SSRF。
- 无 Secret 泄漏。
- 无重复 Job/重复费用缺陷。
- Queue 可恢复。
- Provider outage 可隔离。
- UNKNOWN Job 可对账。
- 回滚演练通过。

**任一 Gate 未通过，不上线。**

---

## 21. 测试矩阵

| Layer | 必测内容 |
|---|---|
| Unit | hash、schema、状态机、authorization、pricing、error mapping |
| Integration | PostgreSQL、Outbox、Queue、S3/R2、OAuth verifier、Fake Provider |
| E2E | Claude OAuth、Tool call、Quote→Job→Asset |
| Security | BOLA、IDOR、SSRF、malware、MIME、webhook replay、token leak |
| Load | Tool concurrency、Job burst、polling、webhook flood、Queue recovery |
| Recovery | Provider timeout、worker crash、DB reconnect、storage failure、duplicate event |

### 21.1 关键 E2E 场景

1. 文生图成功。
2. 文生视频成功。
3. 有参考 Asset 生图。
4. Quote 过期后生成失败。
5. Quote request_hash 被修改后生成失败。
6. 跨 Workspace Asset 被拒绝。
7. 同幂等键同请求仅一条 Job。
8. 同幂等键不同请求冲突。
9. Provider 提交超时进入 UNKNOWN，不重复 submit。
10. Duplicate webhook 不重复 Asset/费用。
11. Provider 成功但 Asset storage 失败，Job 不成功。
12. Cancel 与 Provider complete 竞争时有明确终态。
13. Claude 附件桥接成功或可靠 fallback。

---

## 22. 上线 Checklist

- [ ] 公网 HTTPS / HSTS / WAF 已启用。
- [ ] Claude OAuth Code + PKCE 实测。
- [ ] aud/resource/scope/sub 校验已启用。
- [ ] 固定 10 MCP Tools Schema 冻结。
- [ ] 所有 Write Tool 带 idempotency_key。
- [ ] Workspace 对象级授权通过。
- [ ] Provider Key 只在 Secret Manager。
- [ ] Quote + Budget Reservation 已启用。
- [ ] P0 仅运行预授权 Workspace。
- [ ] Provider output 全部进入自家 Asset。
- [ ] S3/R2 Bucket 非公开。
- [ ] Access URL 短期签名。
- [ ] URL Import SSRF 测试通过。
- [ ] Upload MIME/magic byte/size 检查通过。
- [ ] webhook verify + replay protection 通过。
- [ ] UNKNOWN/Reconciliation 流程通过。
- [ ] 无分钟级 jobs_wait/jobs_poll。
- [ ] Claude Attachment Bridge Gate 有实测结论。
- [ ] Unit/Integration/E2E/Security/Load/Recovery Gate 全通过。
- [ ] Dashboard / Alert / Runbook / Rollback 完成。
- [ ] P0 非目标未被隐式扩展。

---

## 23. P0 完成定义

只有同时满足以下条件，P0 才视为完成：

1. Claude Remote MCP 可完成真实图像生成。
2. Claude Remote MCP 可完成真实视频生成。
3. 两类任务均使用统一 Job/Asset 模型。
4. Provider 凭据从未暴露给 Claude。
5. 重试、重复 Tool Call、重复 Queue Delivery 不造成重复 Job。
6. Provider 提交结果未知时不会盲目重发。
7. 所有结果归档到自家私有 Asset Store。
8. Quote/预算/确认状态可审计。
9. Job/Asset/Quote/Workspace 对象级授权通过。
10. Claude 附件能力有真实 E2E 结论和 fallback。
11. Security Gate 通过。
12. Recovery Gate 通过。
13. 上线 Checklist 全部完成。

此后才能进入 P1。

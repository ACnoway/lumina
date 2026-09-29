# 对象存储后台配置（S3 兼容）改动大纲

## 目标

将图片存储从启动时读取的本地 MinIO 配置，改为由管理员在后台配置的 S3 兼容对象存储；支持 AWS S3、MinIO、Cloudflare R2 等兼容服务。

## 改动范围

1. **存储客户端**：以标准 S3 API 统一上传、删除和生成预签名访问 URL，替换 MinIO 专用命名与配置读取方式。
2. **后台配置**：在管理后台新增对象存储表单，包含 Endpoint、对外 Endpoint（可选）、Region、Bucket、Path-style、Access Key、Secret Key、启用状态和“测试连接”。
3. **安全与权限**：仅管理员可读取、保存和测试配置；Access Key 与 Secret Key 加密入库，读取接口、审计日志和页面只展示掩码或配置状态。加密根密钥仍由部署环境变量提供。
4. **运行行为**：保存并验证成功后刷新后端存储客户端，无需重启；未配置、连接失败或权限不足时，生图返回明确错误。默认只验证已有 Bucket，不自动创建。
5. **迁移约束**：系统只维护一份当前对象存储配置，不保存历史配置快照。变更 Bucket 或服务端点时，需将数据库记录与对象文件整体迁移；迁移完成后，所有图片按新配置访问。
6. **部署整理**：生产环境解除后端和 Nginx 对本地 MinIO 的固定绑定；本地开发与 E2E 可保留 MinIO，作为 S3 兼容测试服务。
7. **验收**：覆盖管理员权限、配置脱敏、连接/权限失败、上传、预签名访问，以及 MinIO 与至少一种外部 S3 兼容服务的冒烟测试。

## 非目标

- 不实现多存储配置并存、历史图片按旧配置访问或脱离管理员显式保存动作的后台自动跨 Bucket 迁移。
- 不在本次改动中修改图片业务流程以外的文件存储场景。

## 已实现

### 数据与密钥

- `SystemConfig` 单例新增当前对象存储配置：Endpoint、对外 Endpoint、Region、Bucket、Path-style、启用状态和配置版本。
- Access Key 与 Secret Key 使用 AES-256-GCM 加密后写入 `objectStorageCredentialsEncrypted`，服务端只从部署环境变量 `OBJECT_STORAGE_CONFIG_ENCRYPTION_KEY` 获取加密根密钥。
- 管理接口只返回 `accessKeyMasked`、`secretKeyMasked` 和配置状态，不返回明文密钥；审计详情同样只记录脱敏配置和是否更新密钥。
- 保存配置时覆盖当前记录，不创建历史快照。

### 后端 API

- `GET /admin/settings/object-storage`：管理员读取脱敏配置。
- `POST /admin/settings/object-storage/test`：管理员验证候选配置，要求凭证可以访问已有 Bucket。
- `PATCH /admin/settings/object-storage`：验证并保存配置，成功后立即刷新后端对象存储客户端。
- 三个接口都挂在管理员 RBAC 保护下；普通用户返回 403。
- Bucket 不存在、Endpoint 不合法、凭证无权访问或加密根密钥缺失时返回明确错误；服务启动时不自动创建 Bucket。

### 存储运行时

- `ObjectStorageService` 通过 S3 兼容 API 完成上传、删除和预签名 GET URL，图片业务只依赖对象存储抽象，不再读取 `MINIO_*` 启动配置。
- 支持独立的内部 Endpoint 和用于预签名 URL 的对外 Endpoint，适配 Docker 内网地址、Nginx 代理、AWS S3、MinIO 和 Cloudflare R2 等场景。
- 未配置或未启用时，生图在上传/生成预签名 URL 阶段返回“对象存储未配置或未启用”的服务不可用错误。

### 配置变更与迁移

- 如果 Endpoint 或 Bucket 发生变化，保存前会验证新旧 Bucket，并根据数据库中已记录的图片 key 将对象复制到新位置、校验目标对象，再切换数据库配置。
- 图片 key 保持不变，因此数据库图片记录不需要生成历史配置快照；切换后所有图片统一通过新配置访问。
- Region、Path-style、对外 Endpoint 或凭证变更不触发对象复制。
- 本地开发和 E2E 仍保留 MinIO 容器作为 S3 兼容测试服务；E2E smoke 在测试 fixture 阶段预先创建 `lumina-images` Bucket，应用本身不负责创建。

### 前端管理页

管理后台“模型与供应商”配置页新增“对象存储（S3 兼容）”表单，支持 Endpoint、对外 Endpoint、Region、Bucket、Path-style、Access Key、Secret Key、启用状态和“测试连接”。编辑已有配置时密钥输入留空表示沿用已保存密钥。

### 验收覆盖

- 后端单元测试覆盖现有图片服务在对象存储错误时的阶段信息；管理端接口沿用全局 JWT + 角色守卫。
- E2E smoke 会创建管理员对象存储配置，验证连接、启用状态、密钥脱敏、普通用户无权访问，以及上传图片、预签名 URL 访问和历史图片读取。
- 由于当前开发机没有运行数据库、Redis、MinIO 或真实 S3 服务，最终 E2E 需在 `lch:/root/lumina` 拉取提交后执行。

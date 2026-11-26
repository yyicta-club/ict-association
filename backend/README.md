# ICT 协会网站 · 后端服务（backend/）

基于 **Bun + Hono 4 + MySQL 8** 的协会站点后端。运行时零新增依赖：密码哈希用 Bun 原生的
`Bun.password`（argon2id），JWT 用 Hono 内置的 `hono/jwt`，跨域用 `hono/cors`。

- 端口：`8787`（`3000` 留给 Nuxt 前端）
- 统一响应体：`{ code, message, data }`，同时返回 HTTP 状态码
- MySQL 未启动时服务照常启动，由 `GET /health` 暴露数据库状态
- 静态资源：图片上传（管理员 / 游客入口）、列表、软删除与恢复，详见 [`docs/static-files.md`](docs/static-files.md)

---

## 1. 快速开始

### 1.1 前置条件

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Bun | >= 1.4 | 运行时与包管理器（本项目 `bun run` 脚本） |
| MySQL | >= 8.0 | 表结构使用 `utf8mb4_0900_ai_ci` 排序规则，5.7 不兼容 |
| pnpm | >= 10 | 仅用于安装依赖（`node_modules` 由 pnpm 管理） |

### 1.2 安装依赖

```sh
cd backend
pnpm install
```

### 1.3 配置环境变量

```sh
cp .env.example .env
```

然后至少修改 `JWT_SECRET`（缺失或短于 32 位时服务会拒绝启动）：

```sh
# 生成一个 64 位随机密钥
bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'))"
```

同时必须配置 `STATIC_FILE_PATH`（上传根目录，**绝对路径**且不能是文件系统根目录），否则服务同样拒绝启动：

```dotenv
# Windows
STATIC_FILE_PATH=D:\upload
# Linux（按平台调整，并确保后端进程可写）
STATIC_FILE_PATH=/var/lib/ict-association/uploads
```

`.env` 已被 `.gitignore` 忽略，不要提交到仓库。

### 1.4 初始化数据库

```sh
bun run db:init            # 首次执行：建库 + 建表 + 初始分类数据
bun run db:init -- --force # 库已存在时强制重建（会清空该库全部数据）
```

`src/db/v1.sql` 开头是 `DROP DATABASE IF EXISTS`，因此脚本会先探测目标库是否已存在：
已存在且未加 `--force` 时直接拒绝执行并提示，避免误删数据。
库名以 `.env` 的 `DB_NAME` 为准，脚本会自动改写 SQL 中写死的库名。

### 1.5 创建初始管理员

```sh
# 方式一：写进 .env 的 ADMIN_INIT_PASSWORD 后执行
bun run seed:admin

# 方式二：命令行传入（不进版本库）
bun run seed:admin -- --username=admin --password='YourPassw0rd!'
```

密码至少 8 位，库中只保存 argon2id 哈希；账号已存在时会重置密码并把状态恢复为「正常」。

### 1.6 启动服务

```sh
bun run dev     # 开发模式（--hot 热重载）
bun run start   # 生产模式
```

启动后：

```sh
curl http://127.0.0.1:8787/health
# {"status":"ok","db":"up",...}
```

---

## 2. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 后端端口（3000 留给 Nuxt） |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `DB_HOST` | `127.0.0.1` | MySQL 主机 |
| `DB_PORT` | `3306` | MySQL 端口 |
| `DB_USER` | `root` | MySQL 用户 |
| `DB_PASSWORD` | 空 | MySQL 密码 |
| `DB_NAME` | `ict_association` | 库名，与 `src/db/v1.sql` 一致 |
| `DB_CONNECTION_LIMIT` | `10` | 连接池上限 |
| `JWT_SECRET` | 无（必填） | >= 32 位随机字符串；缺失时服务拒绝启动 |
| `JWT_EXPIRES_IN` | `7d` | token 有效期，支持 `30s`/`30m`/`12h`/`7d`/`2w` 或纯秒数 |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | 逗号分隔的跨域白名单 |
| `ADMIN_INIT_USERNAME` | `admin` | `seed:admin` 脚本使用的用户名 |
| `ADMIN_INIT_PASSWORD` | 空 | `seed:admin` 脚本使用的密码（至少 8 位） |
| `STATIC_FILE_PATH` | 无（必填） | 上传根目录，**必须是绝对路径**且不能是文件系统根目录；缺失时服务拒绝启动。Windows 示例 `D:\upload`，Linux 示例 `/var/lib/ict-association/uploads`（**必须改成该平台合适的目录**） |
| `STATIC_FILE_RATE_WINDOW_MS` | `60000` | 上传限流窗口（毫秒）；两个上传入口共享同一份 IP 配额 |
| `STATIC_FILE_RATE_MAX` | `10` | 上传限流窗口内最大次数；两个上传入口共享同一份 IP 配额 |
| `TRUSTED_PROXIES` | 空（不信任任何代理） | 逗号分隔的可信代理 IP / CIDR，如 `10.0.0.0/8,192.168.1.1`；**留空表示完全忽略** `X-Forwarded-For` / `X-Real-IP` |

业务代码不直接读 `process.env`，统一从 `src/config/env.ts` 的 `env` 读取。

---

## 3. 目录结构

```
backend/
├── .env.example              # 环境变量模板（提交 git）
├── .env                      # 本地配置（已忽略）
├── package.json              # dev / start / db:init / seed:admin / typecheck / test
├── tsconfig.json             # ESNext + bundler 解析 + strict + bun types
├── README.md
├── docs/
│   └── static-files.md       # 静态图片资源接口 · 运维与后端手册
├── scripts/
│   ├── init-db.ts            # 读取并执行 src/db/v1.sql（建库建表 + 初始数据）
│   └── seed-admin.ts         # 初始化管理员：密码哈希后入库，已存在则更新密码
├── test/
│   ├── app.test.ts           # 接口层集成测试：路由 / 鉴权 / CORS / 404（不访问数据库）
│   ├── utils.test.ts         # 单元测试：密码 / JWT / 限流器 / 响应体 / 入参校验 / 日志脱敏
│   ├── image-inspect.test.ts # 图片签名识别 / 完整解码 / 像素上限
│   └── trusted-proxy.test.ts # 可信代理：IP 归一化 / CIDR 匹配 / 代理链解析
└── src/
    ├── index.ts              # 入口：env 启动校验 → Bun.serve(:8787) → 启动日志
    ├── app.ts                # 组装 Hono：CORS → 日志 → 路由挂载 → /health → 404 → 全局错误
    ├── config/env.ts         # 环境变量集中读取、默认值与启动校验
    ├── db/
    │   ├── index.ts          # mysql2 连接池 + query<T>() / execute() / ping()
    │   ├── v1.sql            # 表结构（含 static_assets.deleted_at 与 idx_deleted_id）
    │   └── migrations/
    │       └── 2026-11-26_static_assets_deleted_at.sql  # 增量迁移（幂等）
    ├── middlewares/
    │   ├── logger.ts         # 请求日志（method/path/status/耗时）
    │   ├── auth.ts           # adminAuth：Bearer 校验 → 写入 c.var.admin
    │   └── upload-rate-limit.ts # 上传限流（固定窗口，两个入口共享同一 IP 配额）
    ├── routes/
    │   ├── admin/
    │   │   ├── index.ts      # /admin 路由组
    │   │   ├── auth.ts       # POST /admin/login
    │   │   ├── user.ts       # POST /admin/user/create、/admin/user/settings
    │   │   └── static-file.ts # 上传 / 列表 / 软删除 / 恢复
    │   ├── tourist/
    │   │   ├── index.ts      # /tourist 路由组（占位，后续新闻/评论在此扩展）
    │   │   └── static-file.ts # POST /tourist/static-files/upload（公开，仅评论配图）
    │   └── static-file-upload.ts # 上传处理逻辑（管理员 / 游客入口共用同一段实现）
    ├── services/
    │   ├── admin-auth.service.ts  # 登录业务逻辑 + 登录日志落库
    │   ├── admin-user.service.ts  # 管理员账户创建与资料修改
    │   ├── static-file.service.ts # 分类白名单、落库、列表、软删除与恢复
    │   ├── static-file-storage.service.ts # 路径规划、独占写入、失败清理
    │   └── system-log.service.ts # system_logs 落库（写入失败不影响主流程）
    ├── utils/
    │   ├── password.ts       # hashPassword / verifyPassword / dummyVerify
    │   ├── jwt.ts            # signAdminToken / verifyAdminToken / parseExpiresIn
    │   ├── response.ts       # ok()/fail() 统一响应 + ErrorCode 常量表
    │   ├── rate-limit.ts     # 内存固定窗口限流器
    │   ├── request.ts        # 客户端 IP / 请求路径等请求侧小工具
    │   ├── ip.ts             # IP 归一化、CIDR 匹配、可信代理链解析（纯函数）
    │   ├── image-inspect.ts  # 图片签名识别 + 完整解码校验 + 像素上限
    │   ├── multipart.ts      # 限长读取请求体（不信任 Content-Length）+ multipart 解析
    │   ├── query-params.ts   # 查询参数校验（正整数 / 固定枚举）
    │   ├── log.ts            # 日志脱敏：describeError() / sanitizeLogDetail()
    │   └── validation.ts     # 用户名 / 密码 / 邮箱等入参校验
    └── types/index.ts        # AdminRow / AdminPublic / JwtAdminPayload / AppVariables
```

---

## 4. API

### 4.1 通用响应格式

```json
{ "code": 0, "message": "成功", "data": {} }
```

| 业务码 | 含义 | HTTP |
| --- | --- | --- |
| `0` | 成功 | 200 |
| `40000` | 参数错误 / JSON 格式错误 / 接口不存在 | 400 / 404 |
| `40100` | 未登录或登录已过期 | 401 |
| `40101` | 用户名或密码错误 | 401 |
| `40300` | 无权限 | 403 |
| `40301` | 账号已被禁用 | 403 |
| `40401` | 管理员不存在 | 404 |
| `40402` | **静态资源不存在** | 404 |
| `40900` | 账户名或邮箱冲突 | 409 |
| `40901` | 账户名已存在 | 409 |
| `40902` | 邮箱已被占用 | 409 |
| `41300` | **单个上传文件超过大小上限** | 413 |
| `41301` | **上传请求体超过大小上限** | 413 |
| `41302` | **图片累计解码像素超过上限** | 413 |
| `41500` | **图片格式不支持** | 415 |
| `41501` | **图片损坏或无法完整解码** | 415 |
| `42900` | 尝试次数过多 | 429 |
| `50000` | 服务器内部错误（全局兜底，不泄露堆栈） | 500 |

### 4.2 `GET /health`

健康检查。数据库可用返回 200，不可用返回 503。

```json
// 200
{ "status": "ok", "db": "up", "uptime": 12, "timestamp": "2026-11-25T00:00:00.000Z" }
// 503
{ "status": "degraded", "db": "down", "uptime": 12, "timestamp": "2026-11-25T00:00:00.000Z" }
```

### 4.3 `POST /admin/login`

管理员登录。

**请求**

```http
POST /admin/login
Content-Type: application/json

{ "username": "admin", "password": "********" }
```

**成功响应** `200`

```json
{
  "code": 0,
  "message": "登录成功",
  "data": {
    "token": "<JWT>",
    "expiresIn": 604800,
    "admin": { "id": 1, "username": "admin", "nickname": "系统管理员", "email": null }
  }
}
```

**处理流程**

1. 解析 JSON（失败 → `40000` / 400）
2. 校验 `username`、`password` 为非空字符串（否则 `40000` / 400）
3. 限流：同一 IP + 用户名 10 分钟内最多 10 次失败尝试（超过 → `42900` / 429）
4. 按用户名查 `admins`；查不到也执行一次假哈希校验，抹平时序差异
5. argon2id 常数时间校验（用户不存在与密码错误返回完全相同的 `40101`）
6. `status = 0` → `40301` / 403
7. 更新 `last_login_at`
8. 签发 HS256 JWT：`{ sub, username, nickname, role: "admin", iat, exp }`
9. 写 `system_logs`（`module = 'auth'`，成功 INFO / 失败 WARN，记录 IP、路径、状态码）

**错误场景**

| 场景 | HTTP | code | message |
| --- | --- | --- | --- |
| 请求体不是合法 JSON | 400 | 40000 | 请求体必须是合法的 JSON |
| 用户名/密码缺失或非字符串 | 400 | 40000 | 用户名和密码不能为空 |
| 超过限流阈值 | 429 | 42900 | 尝试次数过多，请 10 分钟后再试 |
| 用户名不存在 / 密码错误 | 401 | 40101 | 用户名或密码错误 |
| 账号被禁用 | 403 | 40301 | 账号已被禁用，请联系系统管理员 |
| 数据库不可用等异常 | 500 | 50000 | 服务器内部错误 |

### 4.4 `GET /admin/me`（受保护接口示例）

```
Authorization: Bearer <token>
```

```json
{
  "code": 0,
  "message": "当前登录管理员",
  "data": { "id": 1, "username": "admin", "nickname": "系统管理员", "role": "admin" }
}
```

未携带 / 携带非法或过期 token → 401 `40100`。后续所有 `/admin` 写接口挂 `adminAuth` 即可。

### 4.5 `GET /tourist/ping`（占位）

游客端公开接口占位，后续新闻列表、文章详情、评论等都在 `/tourist` 路由组扩展。

### 4.6 静态资源接口总览

五个静态资源接口统一复用既有 Hono 应用、统一响应体 `{ code, message, data }`、`system_logs` 审计日志与 `FixedWindowRateLimiter` 固定窗口限流器。

| 方法 | 路径 | 鉴权 | 允许分类 | 说明 |
| --- | --- | --- | --- | --- |
| `POST` | `/admin/static-files/upload` | 管理员 | `article` / `gallery` / `comment` | 上传图片 |
| `POST` | `/tourist/static-files/upload` | 公开 | 仅 `comment` | 上传评论配图 |
| `GET` | `/admin/static-files/list` | 管理员 | — | 分页查询资源列表 |
| `POST` | `/admin/static-files/delete` | 管理员 | — | 软删除（幂等） |
| `POST` | `/admin/static-files/recover` | 管理员 | — | 恢复软删除（幂等） |

分类白名单只有三个：`article`（文章配图，**仅管理员**）、`gallery`（图库，**仅管理员**）、`comment`（评论配图，**管理员与游客均可**）。白名单在后端强制执行；数据库 `static_assets.category` **没有**新增 ENUM / CHECK 约束，历史分类值继续有效。

**资源元数据**（上传、列表、删除、恢复四个接口返回的对象结构一致）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `number` | 资源 ID |
| `filename` | `string` | 清洗后的原始文件名，仅供展示（已去目录成分与控制字符，最长 255 字符） |
| `path` | `string` | 存储相对路径，形如 `article/2f1c....png` |
| `url` | `string \| null` | 对外访问地址；未接 CDN 时为 `null` |
| `mimeType` | `string` | `image/png` / `image/jpeg` / `image/webp` / `image/gif` |
| `category` | `string` | `article` / `gallery` / `comment` |
| `sizeBytes` | `number` | 文件字节数 |
| `uploaderId` | `number \| null` | 管理员上传为管理员 id，游客上传为 `null` |
| `createdAt` | `string` | 创建时间（MySQL `DATETIME` 字符串） |
| `deletedAt` | `string \| null` | 软删除时间；未删除为 `null` |

> 响应**不暴露磁盘绝对路径**，`path` 是相对于 `STATIC_FILE_PATH` 的相对路径。

### 4.7 `POST /admin/static-files/upload`

管理员上传图片。

**请求**

```http
POST /admin/static-files/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | 文件 | 是 | 图片内容；字段名必须是 `file`，且只能有一个 |
| `category` | 文本 | 是 | `article` / `gallery` / `comment`；字段名必须是 `category`，且只能有一个 |

**成功响应** `200`

```json
{
  "code": 0,
  "message": "上传成功",
  "data": {
    "id": 12,
    "filename": "cover.png",
    "path": "article/2f1c9d0e-....-....-....-............png",
    "url": null,
    "mimeType": "image/png",
    "category": "article",
    "sizeBytes": 48213,
    "uploaderId": 1,
    "createdAt": "2026-11-26 13:45:17",
    "deletedAt": null
  }
}
```

**处理流程**

1. 上传限流（**在鉴权与 multipart 解析之前**）：同一 IP 60 秒固定窗口最多 10 次，失败请求同样消耗额度，超限 → `42900` / 429 + `Retry-After`，且**不读取请求体**
2. 管理员鉴权（缺失 / 非法 token → `40100` / 401）
3. 限长读取请求体（6 MiB，按实际读到的字节数判断，不信任 `Content-Length`）
4. 解析 multipart，只接受一个 `file` 与一个 `category`，缺失 / 重复 / 多文件 / 多余字段 → `40000` / 400
5. 分类校验：未知分类 → `40000`；合法但无权 → `40300`
6. 图片校验：按文件头签名识别格式（只接受 PNG / JPEG / WebP / GIF）+ 完整解码校验 + 累计解码像素上限 4000 万
7. 落盘：`<category>/<随机 UUID>.<规范扩展名>`，独占创建（不覆盖），路径必须落在 `STATIC_FILE_PATH` 根目录内
8. 落库；数据库明确失败时删除本次产生的文件，落库结果无法确认时**保留文件**并记录待核查事件
9. 写审计日志（`system_logs`，`module = 'static-file'`）

**错误场景**

| 场景 | HTTP | code | message |
| --- | --- | --- | --- |
| 未携带 / 非法 token | 401 | 40100 | 未登录或登录已过期 |
| 超过限流阈值 | 429 | 42900 | 上传过于频繁，请 N 秒后再试（带 `Retry-After` 头） |
| `Content-Type` 不是 multipart | 400 | 40000 | 请求必须是 multipart/form-data |
| multipart 解析失败 | 400 | 40000 | multipart 请求体解析失败 |
| 缺少 `file` 字段 | 400 | 40000 | 缺少上传文件（字段名必须为 file） |
| 传了多个文件 | 400 | 40000 | 一次只能上传一个文件 / 只允许上传一个名为 file 的文件 |
| 缺少 `category` 字段 | 400 | 40000 | 缺少分类（字段名必须为 category） |
| `category` 字段重复 | 400 | 40000 | category 字段不能重复 |
| 出现多余字段 | 400 | 40000 | 只接受 file 与 category 两个字段 |
| 分类未知 | 400 | 40000 | 分类只能是 article / gallery / comment |
| 文件为空 | 400 | 40000 | 上传文件不能为空 |
| 请求体超过 6 MiB | 413 | 41301 | 请求体不能超过 6291456 字节 |
| 单文件超过 5 MiB（5,242,880 字节） | 413 | 41300 | 单个文件不能超过 5242880 字节 |
| 累计解码像素超过 4000 万 | 413 | 41302 | 图片像素总量不能超过 40000000 |
| 格式不支持 | 415 | 41500 | 仅支持 PNG / JPEG / WebP / GIF 图片格式 |
| 图片损坏 / 无法完整解码 | 415 | 41501 | 图片文件损坏或无法解析 / 无法完整解码 |
| 目录不可写 / 磁盘满 / 数据库异常 | 500 | 50000 | 服务器内部错误 |

> 合法动画（多帧 GIF / WebP）会被保留。扩展名与 MIME 一律按**识别结果**生成，原始文件名只作清洗后的展示元数据，不参与路径拼接。

### 4.8 `POST /tourist/static-files/upload`

公开入口，**不需要鉴权**。与管理员入口共用同一段处理逻辑和同一个 IP 限流配额，只允许上传 `comment`。

**请求**

```http
POST /tourist/static-files/upload
Content-Type: multipart/form-data
```

字段要求与 4.7 完全一致（一个 `file` + 一个 `category`）。

**成功响应** `200`

结构同 4.7，区别在于 `uploaderId` 恒为 `null`，`category` 恒为 `comment`。

**错误场景**

在 4.7 的全部错误场景基础上，分类规则不同：

| 场景 | HTTP | code | message |
| --- | --- | --- | --- |
| `category` 为**未知值** | 400 | 40000 | 分类只能是 article / gallery / comment |
| `category` 为**合法但无权**的分类（`article` / `gallery`） | 403 | 40300 | 当前身份无权上传该分类 |

> 判定顺序：先判"是否在白名单内"（未知 → 400），再判"当前身份是否允许"（不允许 → 403）。

### 4.9 `GET /admin/static-files/list`

**请求**

```http
GET /admin/static-files/list?category=comment&deleted=false&page=1&pageSize=20
Authorization: Bearer <token>
```

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `category` | 枚举 | 不筛选 | 可缺省；提供则必须是 `article` / `gallery` / `comment` 之一 |
| `deleted` | 枚举 | `false` | `false`（只查未删除）/ `true`（只查已删除）/ `all`（全部）；默认 SQL 条件明确为 `deleted_at IS NULL` |
| `page` | 正整数 | `1` | 页码，从 1 开始 |
| `pageSize` | 正整数 | `20` | 每页条数，**超过上限 100 时按 100 截断** |

**成功响应** `200`

```json
{
  "code": 0,
  "message": "查询成功",
  "data": {
    "items": [ { "id": 12, "filename": "cover.png", "path": "article/....png", "url": null,
                 "mimeType": "image/png", "category": "article", "sizeBytes": 48213,
                 "uploaderId": 1, "createdAt": "2026-11-26 13:45:17", "deletedAt": null } ],
    "total": 128,
    "page": 1,
    "pageSize": 20
  }
}
```

**错误场景**

| 场景 | HTTP | code | message |
| --- | --- | --- | --- |
| 未携带 / 非法 token | 401 | 40100 | 未登录或登录已过期 |
| `category` 不是合法分类 | 400 | 40000 | 分类只能是 article / gallery / comment |
| `deleted` 不是 `false` / `true` / `all` | 400 | 40000 | deleted 只能是 false / true / all |
| `page` / `pageSize` 不是正整数 | 400 | 40000 | page 必须是正整数 / pageSize 必须是正整数 |
| 数据库不可用 | 500 | 50000 | 服务器内部错误 |

**实现约定**：按 **id 倒序**（`ORDER BY id DESC`）；所有查询参数化，筛选与排序片段只由服务端固定枚举生成。

### 4.10 `POST /admin/static-files/delete` / `POST /admin/static-files/recover`

软删除与恢复。两者都**只改删除状态**（写 / 清空 `deleted_at`），磁盘文件与关联关系保持不变。

**请求**

```http
POST /admin/static-files/delete
Authorization: Bearer <token>
Content-Type: application/json

{ "id": 12 }
```

**成功响应** `200`：返回该资源的元数据（删除后 `deletedAt` 为删除时间；恢复后为 `null`）。

**错误场景**

| 场景 | HTTP | code | message |
| --- | --- | --- | --- |
| 未携带 / 非法 token | 401 | 40100 | 未登录或登录已过期 |
| 请求体不是合法 JSON 对象 | 400 | 40000 | 请求体必须是 JSON 对象 |
| `id` 不是正安全整数 | 400 | 40000 | id 必须是正整数 |
| 资源不存在 | 404 | 40402 | 资源不存在 |

> **幂等**：重复删除返回成功（`deletedAt` 保持第一次的删除时间）；重复恢复同样返回成功（`deletedAt` 保持 `null`）。

---

## 5. 安全约定

- 密码只以 argon2id 哈希落库（`memoryCost 64MiB` / `timeCost 3`），响应与日志永不回传哈希或明文
- `verifyPassword` 兼容历史 bcrypt 哈希（Bun 按 `$2b$` / `$argon2id$` 前缀自动识别算法）
- 防用户名枚举：用户不存在与密码错误返回同一业务码、同一文案，并做等价的假哈希校验
- 登录限流防爆破（IP + 用户名 固定窗口，失败计数，成功即清零）
- `system_logs` 只记录 IP、路径、状态码与脱敏后的详情，不记录密码与 token；日志写入失败不影响登录结果
- 全局 `onError` 只返回 `50000`，绝不向客户端泄露堆栈
- CORS 白名单：`CORS_ORIGINS` 之外的来源不会拿到 `Access-Control-Allow-Origin`
- `JWT_SECRET` 至少 32 位、只存在于本地 `.env`（已被 git 忽略）

### 5.1 上传与静态资源相关

- **上传限流**：固定窗口 60 秒内同一 IP 最多 10 次（`STATIC_FILE_RATE_WINDOW_MS` / `STATIC_FILE_RATE_MAX` 可调）。管理员入口与游客入口**共用同一份 IP 配额**；限流检查与计数发生在**鉴权与 multipart 解析之前**，失败请求同样消耗额度，超限时**不读取请求体**。
- **429 只写轻量控制台日志**，不落库，避免限流请求持续写库；响应带 `Retry-After` 头。
- **可信代理**：`getClientIp` 默认**不信任任何代理**，转发头一律忽略；仅当连接的对端地址（socket address）本身命中 `TRUSTED_PROXIES` 时才采信 `X-Forwarded-For` / `X-Real-IP`；代理链**从右向左**剥离可信节点，取第一个**非可信**地址作为真实客户端 IP，整条链都可信时取最左侧；IPv4 / IPv6 统一归一化（去前导零、IPv4-mapped IPv6 折回 IPv4），避免同一地址多种写法绕过白名单。
- **反向代理部署必读**：修复后 `getClientIp` 在未配置 `TRUSTED_PROXIES` 时一律返回代理出口 IP。若服务在反向代理之后却没配 `TRUSTED_PROXIES`，**所有客户端会共用一个限流桶**——上传限流与既有的登录限流都会被误伤。正确做法是把代理出口 IP / CIDR 填进 `TRUSTED_PROXIES`（**不要**填 `0.0.0.0/0`，那等于信任全部来源，启动时会告警）。
- **图片校验**：只接受 PNG / JPEG / WebP / GIF，按**文件头签名**识别并**完整解码校验**；扩展名与 MIME 按识别结果生成，不信任客户端提供的扩展名与 MIME；截断 / 损坏 / 非允许格式一律 415。
- **体积与像素上限**：单文件 1 ~ 5,242,880 字节（5 MiB）、整个请求体 ≤ 6 MiB（按实际读取字节数判断，**不信任 `Content-Length`**）、累计解码像素 ≤ 4000 万（防压缩炸弹）。
- **路径安全**：落盘路径固定为 `<category>/<随机 UUID>.<规范扩展名>`，独占创建（不覆盖），必须落在 `STATIC_FILE_PATH` 根目录内；原始文件名只作清洗后的展示元数据，**不参与路径拼接**。
- **上传目录不得作为脚本执行目录**：不要为该目录配置任何脚本解释器或静态 location 的执行权限（详见 [`docs/static-files.md`](docs/static-files.md)）。
- **文件补偿**：先写文件、后写数据库；数据库**明确失败**时删除本次产生的文件；落库结果**无法确认**（连接中断等）时**保留文件**并记录待核查事件，避免误删已关联成功的文件。
- **日志脱敏**：不再直接打印数据库异常对象，只打印脱敏后的错误描述（错误类型 + 驱动错误码），不输出 SQL、参数、token 与内部绝对路径；日志详情去控制字符、抹掉疑似绝对路径并截断到 500 字符。
- **多实例部署的限制**：本次只实现**单后端实例**部署；多实例下共享限流与跨系统原子提交不在范围内（详见 [`docs/static-files.md`](docs/static-files.md)）。

### 5.2 上线前还需

- 启用 HTTPS、所有 `/admin` 写接口挂 `adminAuth`、多实例部署时把限流换成 Redis、日志脱敏

---

## 6. 常用命令

```sh
bun run dev         # 热重载开发
bun run start       # 生产启动
bun run db:init     # 建库建表 + 初始数据
bun run seed:admin  # 创建/重置初始管理员
bun run typecheck   # tsc --noEmit 类型检查
bun test            # 单元 + 集成测试（密码 / JWT / 限流 / 响应体 / 上传 / 可信代理）
```

`package.json` 里的脚本也可用 pnpm 调用（`pnpm run typecheck` / `pnpm test`），二者等价。

> **仓库目前没有 lint 脚本**：`package.json` 只有 `dev` / `start` / `db:init` / `seed:admin` / `typecheck` / `test`。`typecheck` 是 `tsc --noEmit` 类型检查，**不能冒充 lint**。

---

## 7. 验证状态

### 7.1 本次实际执行的结果

在 `backend/` 目录下实际运行（只读性质的命令，未执行 `db:init` / `db:init -- --force` / `seed:admin`，未连接任何 MySQL 数据库）：

```sh
cd backend
pnpm run typecheck   # -> tsc --noEmit
pnpm test            # -> bun test
```

| 命令 | 结果 |
| --- | --- |
| `pnpm run typecheck` | **通过**，无类型错误（`tsc --noEmit` 退出码 0，无输出） |
| `pnpm test` | **通过**，**150 个用例全部通过，0 失败**（`Ran 150 tests across 4 files`，417 次 `expect()` 断言） |

`pnpm test` 的用例分布：

| 测试文件 | 用例数 | 覆盖内容 |
| --- | --- | --- |
| `test/trusted-proxy.test.ts` | 62 | IP 归一化（去前导零 / 端口 / zone id / IPv4-mapped 折回）、IPv4 与 IPv6 解析、CIDR 匹配、`TRUSTED_PROXIES` 列表解析、可信代理链自右向左剥离、伪造转发头无效 |
| `test/image-inspect.test.ts` | 34 | 文件头签名识别（PNG / JPEG / WebP / GIF）、格式伪装与非图片识别、规范扩展名与 MIME、完整解码校验、累计像素上限（含动画帧数计费） |
| `test/utils.test.ts` | 43 | 密码哈希往返与随机盐、JWT 往返 / 篡改 / 过期 / 错密钥拒绝、有效期解析、限流器、响应体与错误码映射（含静态资源错误码）、入参校验、日志脱敏 |
| `test/app.test.ts` | 11 | `adminAuth` 中间件（无 token / 伪造 token / 合法 token）、未知路由 404、`/tourist` 占位接口、CORS 白名单、`/admin/user/*` 的鉴权拦截 |
| **合计** | **150** | |
### 7.2 已知缺项

- **本仓库目前没有 lint 脚本。** `backend/package.json` 的 `scripts` 只有 `dev` / `start` / `db:init` / `seed:admin` / `typecheck` / `test`，没有 ESLint / Biome 等 lint 配置与命令。
- `pnpm run typecheck` 执行的是 `tsc --noEmit`，属于**类型检查**，**不能冒充 lint**；本节不把它当作 lint 结果。
- 后续如需补上 lint，需要单独引入工具与配置（并把 `lint` 加进 `scripts` 与 CI），本次交付未包含。
- **上传 / 列表 / 软删除 / 恢复 / 限流 / 故障补偿等接口目前没有自动化测试**（随内存假库一并移除），需要回归时只能手工验证或重新引入测试库方案。

待在本机安装 MySQL 8 后复跑（脚本与接口均已就绪）：

```sh
bun run db:init && bun run seed:admin -- --password='YourPassw0rd!'
# 正确密码 → 200 + token；错误密码 → 40101；连错 11 次 → 42900；status=0 账号 → 40301
```

- 真实 MySQL 下的建表、初始管理员与登录链路
- `src/db/migrations/2026-11-26_static_assets_deleted_at.sql` 在生产库上的执行与验证 SQL
- 真实反向代理（Nginx）下的 `X-Forwarded-For` 透传与 `TRUSTED_PROXIES` 匹配
- 真实磁盘上的上传目录权限、并发上传与磁盘写满场景
- **上传 / 列表 / 软删除 / 恢复 / 限流 / 故障补偿各接口的业务链路**（自动化测试已随内存假库移除，需手工或另行引入测试库验证）
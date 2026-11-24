# ICT 协会网站 · 后端服务（backend/）

基于 **Bun + Hono 4 + MySQL 8** 的协会站点后端。运行时零新增依赖：密码哈希用 Bun 原生的
`Bun.password`（argon2id），JWT 用 Hono 内置的 `hono/jwt`，跨域用 `hono/cors`。

- 端口：`8787`（`3000` 留给 Nuxt 前端）
- 统一响应体：`{ code, message, data }`，同时返回 HTTP 状态码
- MySQL 未启动时服务照常启动，由 `GET /health` 暴露数据库状态

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
├── scripts/
│   ├── init-db.ts            # 读取并执行 src/db/v1.sql（建库建表 + 初始数据）
│   └── seed-admin.ts         # 初始化管理员：密码哈希后入库，已存在则更新密码
├── test/
│   ├── utils.test.ts         # 密码哈希往返 / JWT 签发校验 / 限流器 / 响应体
│   └── app.test.ts           # 接口层集成测试：路由 / 鉴权 / CORS / 404（不依赖数据库）
└── src/
    ├── index.ts              # 入口：env 启动校验 → Bun.serve(:8787) → 启动日志
    ├── app.ts                # 组装 Hono：CORS → 日志 → 路由挂载 → /health → 404 → 全局错误
    ├── config/env.ts         # 环境变量集中读取、默认值与启动校验
    ├── db/
    │   ├── index.ts          # mysql2 连接池 + query<T>() / execute() / ping()
    │   └── v1.sql            # 表结构（不变更）
    ├── middlewares/
    │   ├── logger.ts         # 请求日志（method/path/status/耗时）
    │   └── auth.ts           # adminAuth：Bearer 校验 → 写入 c.var.admin
    ├── routes/
    │   ├── admin/
    │   │   ├── index.ts      # /admin 路由组
    │   │   └── auth.ts       # POST /admin/login
    │   └── tourist/index.ts  # /tourist 路由组（占位，后续新闻/评论在此扩展）
    ├── services/
    │   └── admin-auth.service.ts  # 登录业务逻辑 + 登录日志落库
    ├── utils/
    │   ├── password.ts       # hashPassword / verifyPassword / dummyVerify
    │   ├── jwt.ts            # signAdminToken / verifyAdminToken / parseExpiresIn
    │   ├── response.ts       # ok()/fail() 统一响应 + ErrorCode 常量表
    │   ├── rate-limit.ts     # 内存固定窗口限流器
    │   └── request.ts        # 客户端 IP / 请求路径等请求侧小工具
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
- 上线前还需：启用 HTTPS、所有 `/admin` 写接口挂 `adminAuth`、多实例部署时把限流换成 Redis、日志脱敏

---

## 6. 常用命令

```sh
bun run dev         # 热重载开发
bun run start       # 生产启动
bun run db:init     # 建库建表 + 初始数据
bun run seed:admin  # 创建/重置初始管理员
bun run typecheck   # tsc --noEmit 类型检查
bun test            # 单元测试（密码 / JWT / 限流 / 响应体）
```

---

## 7. 验证状态

已在本机完成：

- `bun run typecheck` —— 通过，无类型错误
- `bun test` —— 28 个用例全部通过
  - 单元测试（17）：argon2id 哈希往返、错误密码拒绝、随机盐、JWT 往返 / 篡改 / 过期 / 错密钥拒绝、有效期解析、限流器、响应体与错误码映射
  - 接口集成测试（11）：`/health` 降级逻辑、`/admin/login` 参数校验与 500 兜底、`adminAuth` 中间件（无 token / 伪造 token / 合法 token）、未知路由 404、`/tourist` 占位接口、CORS 白名单放行与拦截
- 冒烟（MySQL 未启动）：服务正常启动；`GET /health` → 503 `degraded`；`POST /admin/login` 参数缺失 → 400 `40000`；非法 JSON → 400 `40000`；正常参数（数据库不可达）→ 500 `50000`；未知路由 → 404 `40000`；`GET /admin/me` 无 token → 401 `40100`
- CORS 预检：`http://localhost:3000` 返回 `Access-Control-Allow-Origin`；非白名单来源不返回该响应头
- 脚本：`bun run db:init` 与 `bun run seed:admin` 在数据库不可达时均给出可操作的错误提示并以非 0 退出码结束（参数校验在连接数据库之前完成）

待在本机安装 MySQL 8 后复跑（脚本与接口均已就绪）：

```sh
bun run db:init && bun run seed:admin -- --password='YourPassw0rd!'
# 正确密码 → 200 + token；错误密码 → 40101；连错 11 次 → 42900；status=0 账号 → 40301
```

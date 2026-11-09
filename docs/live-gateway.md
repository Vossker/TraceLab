# Bilibili 官方授权数据网关

TraceLab 现在包含可运行的 `LIVE_DATA_URL` 服务，代码在 `apps/gateway/`。它实现 OAuth、官方签名、读取账号与作品、逐稿件统计、缓存和标准化输出，并非返回演示 JSON 的空壳。

**当前交付已通过官方协议模拟响应和真实本机 HTTP 链路测试，但没有开放平台应用凭证，尚未完成真实 B 站 OAuth / 作品数据联调。** 配置应用并取得账号授权是最后一个外部前置条件。未配置时服务正常启动，状态为 `app_unconfigured`，不会发起匿名抓取或伪造授权。

## 1. 准备应用

在 [Bilibili 开放平台](https://open.bilibili.com/) 入驻、创建网页应用，并申请对应能力：

- 用户公开信息（通常标识为 `USER_INFO`）。
- 查询用户视频稿件列表（稿件基础权限，通常为 `ARC_BASE`）。
- 获取单个稿件数据（视频数据权限，通常为 `ARC_DATA`）。**只有稿件基础权限时可能读到标题和发布时间，却没有播放与互动统计。** 以应用管理中的实际权限名称和审核结果为准。

官方接口只读取**授权用户自己的**稿件，不是输入任意 UP 主 UID 就能读取的公共目录。应用获批不等于所有 UP 主都已授权；新增权限后还需重新由用户勾选授权。

## 2. 生成本地配置

```bash
npm ci
npm run setup:live
```

该命令创建或更新根目录 `.env`，保留已有 AI 配置，生成随机网关密钥且不打印。已有外部网关地址时会停止，避免覆盖。生成的关键配置：

```dotenv
LIVE_DATA_URL=http://127.0.0.1:3003
LIVE_DATA_PROVIDER=bilibili-official
LIVE_DATA_KEY=<脚本生成的随机值，请保留>
LIVE_GATEWAY_ENABLED=true
LIVE_GATEWAY_PORT=3003
BILIBILI_CLIENT_ID=
BILIBILI_CLIENT_SECRET=
BILIBILI_REDIRECT_URI=http://127.0.0.1:3001/api/live/callback
BILIBILI_MAX_VIDEOS=50
BILIBILI_REQUEST_INTERVAL_MS=1000
```

仅在本机 `.env` 填入 Client ID / Client Secret。平台应用的回调地址必须与 `BILIBILI_REDIRECT_URI` 一致，且符合平台审核要求。不要把 Client Secret、网关密钥或 Token 放入前端、插件、Git 或聊天。

`LIVE_DATA_PROVIDER=bilibili-official` 选择内置协议，不宣称应用已经审核或用户已经授权。`authorized` 状态由服务端令牌与到期时间决定，实际采集成功后才设置 `verified`。外部网关仍支持原有 `LIVE_DATA_AUTHORIZED=true` 声明，参见 [网关契约](data-access.md)。

## 3. 启动与授权

```bash
npm run dev
```

API 进程会同时监听本机 3001（应用）和 3003（官方网关）；Vite 在 5173。打开 **http://127.0.0.1:5173**，点击搜索栏旁的“连接 B 站”。

1. 没有应用凭证：显示“应用尚未配置”，授权按钮禁用。可以照常演示 Demo / Import。
2. 填好 `.env` 并重启：点击“前往 B 站授权”，在 B 站页面由账号本人登录并同意所需权限。
3. 回调完成后返回 Dashboard：显示真实昵称及“已授权”，但尚不声称采集成功。
4. 点击“分析已授权账号”：读取公开已发布稿件、计算指标、保存报告。
5. 点击“数据说明”检查来源、采集时间、采样范围和缺失字段；点击作品可回到 B 站来源。

必须保持 Dashboard 和回调主机一致：`localhost` 与 `127.0.0.1` 的 Cookie 不共享。默认配置请始终使用 `127.0.0.1`。本 MVP 是本机单用户工具；若平台不接受本机回调，需要部署受控的 HTTPS 回调与应用并相应增加公开服务认证，不能只把端口暴露到公网。

生产构建启动：`npm run build` → `npm start` → http://127.0.0.1:3001。回调端口仍为 3001。插件地址设置为当前 Dashboard 地址。

如需独立运行网关，设置 `LIVE_GATEWAY_ENABLED=false` 后单独执行 `npm run gateway`，再启动应用；两种启动方式不要同时占用 3003。`npm run gateway` 同样读取根目录 `.env`。

## 4. 账号身份与字段范围

用户公开信息文档返回 `name / face / openid`，没有公开 UID。内置网关使用 `self` 表示当前授权账号，返回的 `creator.url` 为 `null`，不通过昵称猜 UID，也不将输入主页强行关联到 OAuth 账号。OpenID 不进入浏览器或报告；具体作品仍有独立的真实 BV 链接。输入 UID 到内置网关会明确返回 `SELF_ONLY`。支持按 UID 读取的外部已授权网关不受此别名限制。

| 字段 | 来源 / 行为 |
| --- | --- |
| 昵称、头像 | 官方 `/user/account/info` |
| 标题、描述、标签、封面、BV ID | 官方 `/archive/viewlist` |
| 发布时间 | `ptime`；不用投稿创建时间 `ctime` 代替 |
| 视频时长 | `video_info.duration`，单位秒 |
| 播放、点赞、投币、收藏、评论数、分享 | 官方 `/data/arc/stat` 的 `view/like/coin/favorite/reply/share` |
| 个人简介、粉丝数 | 本实现未读取额外用户统计接口，保持缺失 |
| 评论正文、字幕、弹幕 | 未接入；不以评论数伪造评论样本 |

只保留 `status=pubed` 且 `addit_info.state=0` 的开放浏览稿件。异常日期、无效 BV ID 和结构不符行跳过并计数，分页按 BV ID 去重；数值负数、非整数和缺失值为 `null`，真实零保留。

## 5. 配额、缓存与失败策略

- 每页 50 条；默认保留前 50 条有效作品，可配置 1–200 条。按上游顺序取样，**不声称最新顺序、完整历史或无偏抽样**。分页页数、上游总数、有效样本数和统计覆盖写入报告。
- 单进程串行请求，默认间隔 1 秒，允许 500–10,000 毫秒；这是客户端节流，不是平台公布的配额。真实额度以应用后台为准。
- 单请求 12 秒超时；每次采集约 90 秒预算（最后一个请求可能额外耗时 12 秒）。达到预算保留已取得数据，其余字段为空。
- 内存缓存 10 分钟；并发采集共享任务。缓存保留原采集时间，重启丢失。每次研究仍先请求用户资料确认授权有效。
- 403 / 412 / 429 或平台限制错误：停止当前上游阶段，设置 10 分钟冷却；**不自动重试、不更换端点、不读取网站 Cookie、不进行 WBI 逆向签名**。官方 HMAC 签名使用申请到的本应用密钥。
- 列表读取失败：整次研究失败。统计权限不足或统计网络失败：停止统计，保留已取得的作品和统计，显示警告。令牌失效或用户撤回必要授权时清除本地授权并失败。
- `expires_in` 按官方文档解释为绝对 UTC 秒时间戳。在到期前 5 分钟内、下一次数据请求时做单次续期；已过期需重新授权。刷新失败不重复消费一次性 refresh token。

## 6. 服务与授权状态

所有网关端点只监听 `127.0.0.1`，要求 `Authorization: Bearer <LIVE_DATA_KEY>`，拒绝浏览器 Origin 请求。浏览器通过应用 API 访问，永远拿不到网关密钥。

| 方法 | 网关路径 | 响应 |
| --- | --- | --- |
| GET | `/capabilities` | 配置、授权、账号昵称、能力、采集验证时间；没有任何 Token |
| GET | `/creators/self` | 标准 Creator；每次验证上游用户身份 |
| GET | `/creators/self/videos` | videos / total / coverage / collectedAt / source / warnings |
| GET | `/videos/:bvid` | 当前授权账号样本内的标准 Video |
| GET | `/creators/self/comments` | 501，明确未实现正文读取 |
| POST | `/oauth/start` | 创建浏览器绑定的 10 分钟随机 state，返回官方授权 URL |
| POST | `/oauth/exchange` | 一次性校验 state、绑定 Cookie、交换 Token、读取真实用户信息 |
| DELETE | `/oauth/grant` | 清除本机 Token、缓存和待完成授权 |

应用端新增 `/api/live/authorize`、`/api/live/callback`、`/api/live/authorization`；`POST /api/research` 支持 `{ "account": "self" }`。普通 `{ "url": "..." }` 保留给按 UID 提供数据的外部网关。

授权状态：`app_unconfigured` → `authorization_required` → `authorized` → `token_expired`。`verified` 仅在当前有效授权成功采集后为 true。授权失效、断开或切换账号使其失效。这个标志不是永不失效的可用性承诺。

令牌存储于 `.data/gateway/oauth.enc`，AES-256-GCM 加密，密钥由服务端 `LIVE_DATA_KEY` 派生。更换密钥后旧文件不能解密；恢复旧密钥或删除该文件后重新授权。`.env` 与 `.data/` 均被 Git 忽略。加密不能防御同时读到 `.env` 的本机攻击者。

“忘记本机授权”不撤销 B 站平台授权，也不删除已有 SQLite 报告。平台侧撤权在 B 站管理；本机工具未部署公网撤权 Webhook，下次接口拒绝授权时清除本地凭证。

## 7. 验证与待验证

运行 `npm run verify`。自动化测试覆盖签名字段、OAuth 参数和绝对到期时间、state 浏览器绑定与重放防护、加密存储、续期并发、分页去重、缺失值、权限不足、限流停止、缓存和断开授权。

集成测试启动实际本机 HTTP 服务，以模拟官方响应跑通 **Dashboard API → OAuth 回调 → 网关 → Adapter → 统计 → SQLite 报告**；只模拟 B 站上游，不用它声称真实接口已通。

真实联调需有应用凭证后按第 3 节执行，并检查：资料昵称符合授权账号、数据与 B 站作品页合理一致、权限不足时统计缺失、Token 到期前续期、B 站撤权后重新研究报错。没有凭证时这些外部行为仍属待验证。

## 8. 协议依据

实现于 2026-11-09 对照开放平台文档，避免采用已归档的旧版 demo：

- [网页应用接入（2025 年起的新授权页面）](https://share.apifox.cn/apidoc/docs-site/1106400/doc-885676)
- [账号授权、Token 和刷新](https://share.apifox.cn/apidoc/docs-site/1106400/doc-7492454)
- [签名 2.0 与错误码](https://share.apifox.cn/apidoc/docs-site/1106400/doc-885734)
- [获取用户公开信息](https://share.apifox.cn/apidoc/docs-site/1106400/api-23691686)
- [查询用户视频稿件列表](https://share.apifox.cn/apidoc/docs-site/1106400/api-23727647)
- [获取单个稿件数据](https://share.apifox.cn/apidoc/docs-site/1106400/api-23908635)

接口可用性、权限审批、回调域与配额受平台控制；文档响应样例不能代替真实凭证联调。

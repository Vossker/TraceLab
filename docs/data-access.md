# 数据访问验证与授权 Adapter

## 接口验证记录

2026-11-09 16:04（北京时间），使用 `npm run probe:bilibili` 对以下地址各执行一次匿名只读请求。不读取 Cookie，不登录，不签署 WBI，不重试或绕过访问限制。

| 能力 | 实际结果 | 本项目处理 |
| --- | --- | --- |
| Bilibili 官方开放平台首页 | HTTP 200；页面为动态站点，未取得可用授权文档正文 | 不声称获得开发者权限 |
| 创作者资料 `/x/web-interface/card?mid=2` | HTTP 200 / API code 0 | 仅证明该次匿名请求可读，不代表获授权或长期稳定 |
| 视频列表 `/x/space/arc/search?mid=2&pn=1&ps=1` | HTTP 200 / API code **-799** | 列表不可用，不能建立完整 Live 链路 |
| 单视频统计 `/x/web-interface/view?aid=170001` | HTTP 200 / API code 0 | 同上，不能由单视频读取推断全量采集能力 |
| 评论 `/x/v2/reply?type=1&oid=170001&pn=1&ps=1` | HTTP 200 / API code 0 | 仅测试公开样本可读，不写入正式报告 |
| 字幕 / 弹幕 | 未获得访问授权，未请求 | 明确不支持，不虚构内容 |

这些路径是能力探测对象，**不是产品运行时的数据源**。匿名接口的授权范围、调用配额、平台条款兼容性未得到确认。产品不通过重试、Cookie、验证码、代理池或反爬绕过来补全数据。这些匿名路径不进入运行时；Live 运行时改用官方 OAuth 网关，不会在失败时悄悄返回 Demo。

官方资料入口：[Bilibili 开放平台](https://open.bilibili.com/)、[开放平台文档](https://open.bilibili.com/doc)、[用户使用协议](https://www.bilibili.com/blackboard/protocal/licence.html)。初次探测未取得正文；后续已读取开放平台的 API 文档并实现 OAuth 2.0 / 签名 2.0，具体依据见 [官方授权网关](live-gateway.md#8-协议依据)。开发者仍需在官方平台确认应用授权、允许用途和配额。

## 三种模式

- **Demo**：仓库内生成的虚构创作者“林间实验室”，108 条视频、12 条评论。固定随机种子，不伪装成真实账号。无外部视频链接。
- **Import**：用户提供并有权使用的 CSV / JSON。保留来源和采集时间，不证明其真实性。缺失字段为 null。导入 Demo JSON 后继续保留 demo 标识。
- **Live**：内置官方 OAuth 数据网关或用户配置的外部已授权网关，先能力与授权验证，再读取标准化数据。已实现网关服务；真实开放平台应用凭证尚未配置，未完成真实上游联调。接入见 [官方授权网关](live-gateway.md)。

## 授权网关契约

仅在你已确认数据源授权和平台允许用途后配置：

```dotenv
LIVE_DATA_URL=https://your-authorized-data-service.example
LIVE_DATA_KEY=your-server-only-key
LIVE_DATA_AUTHORIZED=true
```

`LIVE_DATA_AUTHORIZED` 是运营者的授权声明，不是系统自动授予的权限。网关必须实现下列 JSON 响应；所有请求可携带 `Authorization: Bearer <LIVE_DATA_KEY>`。HTTPS 必须有效；本地调试只允许 localhost / 127.0.0.1 的 HTTP。拒绝 HTTP 重定向；作品采集请求最多 130 秒、健康检查 3 秒，不自动重试。内置网关上游每个请求 12 秒超时，串行节流。

### GET /capabilities

```json
{"platform":"bilibili","authorized":true,"capabilities":["creator","videos","comments"]}
```

至少需要 creator 和 videos；系统不因存在 URL 就声称数据源已验证。内置网关未配置 / 未授权时返回 authorized=false 和具体 message；只有成功采集后 verified=true，并提供 lastVerifiedAt。

### GET /creators/:id

返回 `Creator` 模型，id 必须与请求一致，platform 必须为 bilibili。内置官方网关只接受 self：官方资料只含 OpenID，不强行绑定公开 UID，主页 URL 为 null。

### GET /creators/:id/videos

```json
{
  "videos": [],
  "total": null,
  "coverage": "说明视频列表的分页、时间范围、筛选及完整性",
  "collectedAt": "2026-11-09T08:00:00Z",
  "source": "数据提供者及上游接口来源",
  "warnings": ["数据覆盖与缺失情况"]
}
```

videos 实际必须至少 1 条并满足 `packages/core/src/model.ts`。列表中可带已经获取的互动字段，不存在的数值为 null。这里的空数组只展示响应结构，不是可导入样本。

### GET /creators/:id/comments（可选）

返回 Comment 数组，包括 id、videoId、text、likes、collectedAt、source。videoId 必须出现在视频集合中。不可用时允许返回 403 / 404，报告记录评论降级。

### GET /videos/:id（可选，独立互动补全扩展点）

返回标准化 Video；`EngagementProvider` 从中提取互动字段。应用 Adapter 使用列表内已标准化的互动字段；内置官方网关在返回列表前逐视频调用官方统计接口完成补全。

## LLM

服务端使用兼容 [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 的结构化 `json_schema` 输出；参考 [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)。模型通过 `AI_MODEL` 指定，不预设可用型号、价格或凭证。两步处理、错误恢复与引用校验由自动化测试覆盖（使用模拟服务）；2026-11-09 另用 `kimi-k3.1-pro` 跑通过真实流程。

## 后续探测与实现（2026-11-09）

16:56:42 北京时间，对公开列表 `https://api.bilibili.com/x/series/recArchivesByKeywords?mid=163637592&keywords=&pn=1&ps=3` 的匿名请求返回 **HTTP 412 / code -412 / request was banned**。已停止这条路径，没有使用 Cookie、代理、逆向签名或换端点规避限制。探测脚本 `scripts/probe-live-source.mjs` 仅留作只读诊断记录，不是运行时依赖；没有必要继续探测受限路径。

目前没有开放平台应用，因此先实现了可配置的官方授权网关。实际代码、配置与验证清单见 [live-gateway.md](live-gateway.md)。本机 HTTP 集成测试的上游响应均为明确的协议测试夹具，不当作真实 B 站采集证据。

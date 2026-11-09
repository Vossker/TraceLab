# 网站公开接口读取（实验性）

已实现服务端 `PublicBilibiliProvider`，与官方 OAuth 网关独立。无需 Client ID / Secret 或 LIVE_DATA_URL；不读取 Cookie，不模拟登录，不做 WBI 逆向签名，不使用代理或接口轮换。

## 使用

1. `npm run dev`，打开 http://127.0.0.1:5173。
2. 粘贴 UID 或 `https://space.bilibili.com/<UID>`，点击开始研究。默认来源为“网站公开接口”。
3. 也可以在“连接 B 站”中选择“网站公开接口”或“官方 / 授权网关”。前者按 UID 读取，后者保留原有 OAuth / 外部网关功能。
4. Chrome 扩展重新加载 `dist/extension` 后，识别当前主页或手动输入 UID，打开 Dashboard 时带入 `source=public`。在 Dashboard 点击分析后才联网；不会在浏览网页时后台抓取。

支持任意**格式有效**的 UID / 主页作为输入，不保证每个账号都可读取。账号不存在、作品不可见、接口变更、登录/验证要求和访问限制都会影响结果。报告不会在失败时替换成模拟账号。

## 读取接口

| 顺序 | 固定接口 | 用途 |
| --- | --- | --- |
| 1 | `/x/web-interface/card?mid=...` | 昵称、简介、头像、粉丝数，并核对返回 UID |
| 2 | `/x/series/recArchivesByKeywords` | 按 UID 查询作品；keywords 为空，pn 从 1 开始，ps=30，orderby=pubdate |
| 3 | `/x/web-interface/view?bvid=...` | 简介、分区、播放和互动统计，核对 BV ID 及 owner.mid |

这些是 B 站网站接口，不是开放平台授权接口。参考社区维护的 [列表字段记录](https://raw.githubusercontent.com/bilibili-plugins/bilibili-api-collect/master/docs/video/collection.md) 和 [视频详情字段记录](https://raw.githubusercontent.com/bilibili-plugins/bilibili-api-collect/master/docs/video/info.md)；文档本身不证明可用性或授予数据使用权限。

## 数据质量与限制

- 默认每次最多 30 条列表作品，非完整历史。底层支持限量分页，并按 BV ID 去重。
- 只保留 state=0、发布时间有效的作品；ctime 不替代 pubdate。
- 每条详情核对 BV ID。owner.mid 不同的作品排除，并报告排除数量，不猜测联合投稿关系。尚未获得详情的作品只保留列表提供的字段，并说明详情覆盖率。
- 整数精确值保留，真实零保留；缺失、负数、非整数计数保持 null。没有评论正文、字幕或弹幕；评论数不作为评论样本。
- 主题取自详情的分区，来源标为 `platform`，不增加请求。匿名响应的 `tname`、`tname_v2` 实测（2026-11-09，3 条视频）为空，因此按 `tid` 查 `packages/core/src/bilibili-zones.ts`（依据社区文档 [视频分区一览](https://raw.githubusercontent.com/bilibili-plugins/bilibili-api-collect/master/docs/video/video_zone.md)）；若上游返回非空名称则优先使用。未收录的 `tid` 不猜测，详情失败或无分区的作品回退关键词规则，并在警告中注明数量。
- mode 为 live；source 明确标为“网站公开接口（非开放平台）”，不标为官方授权。
- 默认串行、请求间隔 1 秒、单请求 10 秒超时、总预算约 80 秒（最后一个在途请求可能再耗时 10 秒）。这不是平台官方配额承诺。
- 同进程按 UID 合并并发请求，最多缓存 20 个账号、10 分钟，保留原采集时间。缓存结果是快照，不是实时推送。
- 访问限制错误（如 HTTP 403/412/429、code -352 或验证凭据要求）触发进程级 1 分钟冷却；无自动重试、无备用端点轮换。
- 第一页无法读取时研究失败；后续分页或详情失败时保留已有真实字段并附警告。不会伪造完整成功。

可用 `PUBLIC_DATA_ENABLED=false` 关闭公开接口。官方授权入口仍保留。`GET /api/health` 的 `publicData` 显示当前进程的状态、最近失败和最近成功样本 UID；某个样本成功不代表所有 UID 可用。冷却和缓存均为进程内状态，重启清空；不要通过反复重启规避限制。

## API

```json
POST /api/research
{"url":"https://space.bilibili.com/2","source":"public"}
```

返回任务 ID，通过 `/api/jobs/:id` 查询真实状态，再用 `/api/reports/:id` 读取报告。省略 source 时保留旧 API 行为（gateway），前端和扩展明确选择 public。已有 `{account:"self"}` 继续走官方网关。

## 验证记录（2026-11-09，北京时间）

- 18:15，真实匿名读取 UID 2 的资料、29 条有效列表记录及部分视频详情；第三条详情发现 owner 不匹配，原实现拒绝整次研究。随后改为明确排除这类作品，添加回归测试。
- 18:16，修正后的复测在列表阶段返回 HTTP 412，已停止，没有继续换 UID、端点或身份试探。
- 18:5x，加入分区主题后，真实匿名采集一名创作者并运行 `analyze`，保留 28 条作品，主题均来自 B 站分区（此前 27 条为“其他内容”）。该次未经过 HTTP 服务和界面，也不代表其他 UID 可读取。此前诊断时列表接口曾返回 HTTP 412，说明限制可能随时出现。
- 19:13，通过应用用真实公开接口数据生成了完整报告，28 条作品的主题均来自 B 站分区。这不代表任意账号都能稳定读取。
- 自动化测试使用明确的模拟上游响应，覆盖归属校验、去重、缺失字段、部分失败、限流、缓存与实际本机 HTTP 报告链路。

手工诊断命令：`npx tsx scripts/check-public-live.ts <UID>`。该命令会实际联网，最多按上述预算采集；不要在受限后循环调用。真实可用性受当前网络和平台状态影响。

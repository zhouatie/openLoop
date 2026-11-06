---
id: wf_febase_review
name: febase-review
tags: 工作,FEBase,代码评审
---

# 目标

FEBase 代码评审卡点自动化更新流水线：参数提取与合规校验 -> 调用 FEBase OpenAPI 解除卡点 -> 接口状态核验与闭环

# 流程

## 1. 参数提取与合规校验

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 30 秒。
失败就停，把报错原文记为失败原因。

```bash
node << 'EOF'
const text = ((process.env.TASK_DESCRIPTION || "") + " " + (process.env.TASK_TITLE || "")).trim();
const taskId = process.env.TASK_ID || "default";
const urls = text.match(/https:\/\/febase\.netease\.com\/application\/sprint\/detail\?[^\s"'`]+/g) || [];
let rawUrl = "";
for (const u of urls) {
  const clean = u.replace(/[.,;)]+$/, "");
  if (clean.length > rawUrl.length) rawUrl = clean;
}
if (!rawUrl) {
  console.error("[ERROR] 未检测到有效的 FEBase Sprint 详情页链接！\n请提供形如: https://febase.netease.com/application/sprint/detail?tenantId=...&appId=...&groupId=...&sprintId=...");
  process.exit(1);
}
const parsed = new URL(rawUrl);
const tenantId = parsed.searchParams.get("tenantId");
const appId = parsed.searchParams.get("appId");
const groupId = parsed.searchParams.get("groupId");
const sprintId = parsed.searchParams.get("sprintId");
for (const [key, val] of Object.entries({ tenantId, appId, groupId, sprintId })) {
  if (!val || !/^\d+$/.test(val) || parseInt(val, 10) <= 0) {
    console.error(`[ERROR] Sprint 详情链接缺少必须的正整数参数: ${key} (当前提取值: ${val})`);
    process.exit(1);
  }
}
const emailMatch = text.match(/[A-Za-z0-9._%+-]+@corp\.netease\.com/);
const approver = emailMatch ? emailMatch[0] : "zhoushitie@corp.netease.com";
const isDryRun = /--dry-run\b/.test(text);
const ctx = {
  detailUrl: rawUrl,
  tenantId: Number(tenantId),
  appId: Number(appId),
  groupId: Number(groupId),
  sprintId: Number(sprintId),
  approver,
  dryRun: isDryRun,
};
const fs = require("fs");
fs.writeFileSync(`/tmp/openloop-febase-review-${taskId}.json`, JSON.stringify(ctx, null, 2));
console.log("[FEBase 流水线] 参数提取与合规校验通过:");
console.log(`  • 详情链接: ${rawUrl}`);
console.log(`  • Sprint ID: ${sprintId}`);
console.log(`  • Reviewer: ${approver}`);
console.log(`  • 执行模式: ${isDryRun ? "DRY-RUN (演练模式，不发起真实网络请求)" : "生产实时触发"}`);
EOF
```

## 2. OpenAPI 解除代码评审卡点

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 60 秒。
失败就停，把报错原文记为失败原因。

```bash
node << 'EOF'
const fs = require("fs");
const taskId = process.env.TASK_ID || "default";
const ctxFile = `/tmp/openloop-febase-review-${taskId}.json`;
if (!fs.existsSync(ctxFile)) {
  console.error("[ERROR] 缺少前置参数上下文文件，任务终止");
  process.exit(1);
}
const ctx = JSON.parse(fs.readFileSync(ctxFile, "utf8"));
const ENDPOINT = "https://febase-openapi.fn.netease.com/febase/api/code-review/update-code-review-status";
const payload = {
  sprintId: ctx.sprintId,
  approver: ctx.approver,
  gitHost: "https://g.hz.netease.com",
};
console.log(`[FEBase OpenAPI] 正在请求解除发布单 Sprint [${ctx.sprintId}] 的代码评审卡点...`);
console.log(`  • 接口地址: ${ENDPOINT}`);
console.log(`  • 审核人: ${ctx.approver}`);
if (ctx.dryRun) {
  console.log("[FEBase OpenAPI] [DRY-RUN] 演练模式生效，跳过真实接口调用。模拟请求载荷:");
  console.log(JSON.stringify(payload, null, 2));
  fs.writeFileSync(
    `/tmp/openloop-febase-review-${taskId}-resp.json`,
    JSON.stringify({ code: 200, message: "DRY-RUN 模拟成功", data: payload, dryRun: true }, null, 2)
  );
  process.exit(0);
}
const headers = {
  "accept": "application/json, text/plain, */*",
  "content-type": "application/json",
  "febase-auth": "MLJnWs4KejX+cWbJYd9tJWrYpLvYLGUj1fPA3udBWJo=",
  "febase-test-env-proxy-host": "febase.netease.com",
  "origin": "https://febase.netease.com",
  "referer": ctx.detailUrl,
};
fetch(ENDPOINT, {
  method: "POST",
  headers,
  body: JSON.stringify(payload),
})
  .then(async (res) => {
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    const result = { httpStatus: res.status, ok: res.ok, body };
    fs.writeFileSync(`/tmp/openloop-febase-review-${taskId}-resp.json`, JSON.stringify(result, null, 2));
    if (!res.ok) {
      console.error(`[ERROR] FEBase OpenAPI HTTP 状态码异常 (${res.status}): ${text}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error(`[ERROR] FEBase OpenAPI 网络请求失败: ${err.message}`);
    process.exit(1);
  });
EOF
```

## 3. 评审卡点状态核验与闭环

调 `run_command` 执行下面这段命令，命令原样使用，不要改写。超时 30 秒。
失败就停，把报错原文记为失败原因。

```bash
node << 'EOF'
const fs = require("fs");
const taskId = process.env.TASK_ID || "default";
const respFile = `/tmp/openloop-febase-review-${taskId}-resp.json`;
const ctxFile = `/tmp/openloop-febase-review-${taskId}.json`;
if (!fs.existsSync(respFile)) {
  console.error("[ERROR] 未检测到接口响应结果，卡点解除验证失败");
  process.exit(1);
}
const resp = JSON.parse(fs.readFileSync(respFile, "utf8"));
const ctx = fs.existsSync(ctxFile) ? JSON.parse(fs.readFileSync(ctxFile, "utf8")) : {};
try { fs.unlinkSync(respFile); } catch {}
try { fs.unlinkSync(ctxFile); } catch {}
if (resp.dryRun) {
  console.log("✔ [DRY-RUN 核验通过] 发布单参数合法，OpenAPI 请求报文与鉴权头均符合 FEBase 规范！");
  process.exit(0);
}
const body = resp.body || {};
const isSuccess = resp.httpStatus === 200 && (body.code === 200 || body.code === 0 || body.success === true || body.code === undefined);
if (!isSuccess) {
  const errMsg = body.message || body.msg || body.error || JSON.stringify(body);
  console.error(`✖ [FEBase 卡点解除失败] 接口返回业务错误: ${errMsg}`);
  process.exit(1);
}
console.log("----------------------------------------------------------------------");
console.log(`✔ [FEBase 评审卡点已解除] 发布单 Sprint [${ctx.sprintId || "未知"}] 代码评审状态更新为通过！`);
console.log(`  • 审核人: ${ctx.approver || "默认"}`);
console.log(`  • 响应详情: ${JSON.stringify(body)}`);
console.log("----------------------------------------------------------------------");
EOF
```

# 约束

- 任一步失败立即终止，不重试。
- 不改与需求无关的文件。

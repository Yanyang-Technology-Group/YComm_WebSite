# Security Policy

## Supported versions

| Version | 支持 |
|---|---|
| master（滚动） | ✅ 唯一维护线 |

## Reporting a vulnerability

请不要在公开 Issue 中披露漏洞细节。私信报告方式（任选）：

- 到 GitHub 仓库创建 **privately report a vulnerability**（仓库 Settings → Security
  → Report a vulnerability，仅维护者可见）；
- 或直接联系维护者邮箱（见仓库主页）。

请包含：
- 受影响版本 / 提交号；
- 复现步骤（最小可复现）；
- 影响范围（如权限绕过、数据泄露、XSS 等）。

维护者会在 **5 个工作日**内回复，确认后按影响面协调修复与披露时间。

## 安全边界速览（本项目重点）

- 所有资源访问必经 `packages/access` 判定链（状态门 → 策略门 → 权限点），
  web 层结构上无法绕过（ESLint import 边界强制）。
- 外链与网盘提取码**不落任何列表/详情 API**，仅经下载门禁后 302/短时效揭示；
  CVE 相关回归由 `downloads.integration.test.ts` 的安全断言守护。
- 会话 cookie 使用 `__Host-` 前缀（HttpOnly/Secure/SameSite=Lax）；
  密码 argon2id；令牌存哈希；改密即撤销全会话。
- 依赖许可证由 `npm run licenses` 在 CI 强制 AGPL 兼容。
- 修复流程：`git commit -s`（DCO）→ push master → CI（Release 流水线 verify）全绿。
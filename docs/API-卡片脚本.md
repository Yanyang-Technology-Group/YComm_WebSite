# 下载区卡片 · 脚本调用指南

用开放 API 密钥（`Authorization: Bearer`）从脚本 / CI / 其他系统批量管理下载区卡片。
所有示例的 `$BASE` 都是站点地址，例如 `https://community.yanyn.cn`。

---

## 0. 准备：拿一把 API 密钥

1. 用**站长账号**登录网页 → 管理后台 → 左侧「**API 密钥**」；
2. 填名称（如 `CI 建卡`）、可选有效期（0 = 永久）、可选**只读**（勾上后只能 `GET`）；
3. 点「创建」→ **明文只显示这一次**，形如 `ycomm_dPLARAXG…`，立刻复制保存；
4. 用 `curl` 里带的这把 key 就是**站长本人身份**（全部权限）。

> 密钥只在创建时可见；忘了就删掉重建。站长身份一旦转让，旧密钥立即失效。
> 自查：`curl -H "Authorization: Bearer $KEY" $BASE/api/auth/me` 应返回站长账号信息。

---

## 1. 通用约定

| 项目 | 说明 |
|---|---|
| 基址 | `<站点>/api` |
| 鉴权 | `Authorization: Bearer ycomm_…`（**不要**同时带 Cookie，二选一即可） |
| 请求体 | `Content-Type: application/json` |
| 成功响应 | `{ "ok": true, "data": { … } }` |
| 失败响应 | `{ "ok": false, "error": { "code", "messageKey", "message"?, "meta" } }` |
| 频率限制 | 管理接口**没有**限流；但请勿高频轮询，建议一次拉全量再本地比对 |
| 只读密钥 | 只允许 `GET`/`HEAD`；写操作返回 `403 FORBIDDEN` |

常见错误码：

| HTTP | code | 典型原因 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 字段缺失/超长，具体原因在 `error.meta.issues[]` |
| 401 | `UNAUTHENTICATED` / `ACCESS_LOGIN_REQUIRED` | 没带 key 或 key 无效/过期/被撤销 |
| 403 | `FORBIDDEN` | 只读 key 做写操作；或不是站长 |
| 404 | `NOT_FOUND` | 卡片 / 路由不存在 |

400 的错误长这样（脚本里请打印 `error.meta.issues`，比 message 有用）：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "messageKey": "VALIDATION_FAILED",
    "meta": { "issues": [{ "path": "title", "message": "String must contain at least 1 character(s)" }] }
  }
}
```

---

## 2. 卡片有哪些字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string，1–80，**必填** | 卡片标题 |
| `subtitle` | string，≤200 | 简介，**支持 Markdown**（含内联 HTML 白名单），例如 `常用工具，[官网](https://a.com)` |
| `kind` | `container` \| `redirect` \| `resources` | 点击行为：进子层 / 直接跳外链 / 进资源列表。默认 `container` |
| `visibility` | `public` \| `login` \| `invite` \| `staff` | 可见度：公开 / 需登录 / 需绑定注册码 / 仅管理员。默认 `public` |
| `parentId` | uuid \| null | 放进哪张卡片里（无限套娃）；`null` = 根层 |
| `insertBeforeId` | uuid | **仅创建时**：插到这张卡片前面（同层后续卡片自动后移），会忽略 `parentId`/`position` |
| `position` | int | 同层排序位（越小越靠前）；不传则自动排在末尾 |
| `w` / `h` | int，1–6 | 网格尺寸（宽 / 高，单位是网格格数） |
| `redirectUrl` | string \| null | 仅 `kind=redirect` 用：点击跳转的地址 |
| `subtitleUrl` | string \| null | 遗留字段，现已不用（简介里的链接请直接写 Markdown） |
| `status` | `pending` \| `approved` \| `rejected` | **只读**。管理员创建 = `pending`（前台不可见）；站长创建 = `approved` |

> ⚠️ **最容易踩的坑**：管理员建的卡片是 `pending`，前台看不到，需要站长审核
> （`POST /api/admin/cards/:id/review`）。**用站长密钥建卡则直接 `approved`。**

---

## 3. 接口一览

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/admin/cards` | 列出**全部**卡片（含 pending / 各可见度），扁平数组，自己按 `parentId` 组树 |
| POST | `/api/admin/cards` | 创建卡片（201） |
| PATCH | `/api/admin/cards/:cardId` | 修改字段（字段同创建，但都可选；不支持 `insertBeforeId`） |
| POST | `/api/admin/cards/:cardId/move` | `{"direction":"up"｜"down"}` 同层上移/下移 |
| POST | `/api/admin/cards/:cardId/review` | `{"decision":"approve"｜"reject"}` **仅站长** |
| DELETE | `/api/admin/cards/:cardId` | 删除（**子卡片级联删除**） |
| GET | `/api/downloads/cards` | 前台可见卡片（公开接口，无需 key，按访问者可见度过滤） |

---

## 4. curl 逐条示例

先设两个变量：

```bash
BASE=https://community.yanyn.cn
KEY=ycomm_把你的密钥粘贴到这里
```

### 4.1 列出全部卡片

```bash
curl -sS -H "Authorization: Bearer $KEY" "$BASE/api/admin/cards" \
  | jq '.data.cards[] | {id, parentId, title, kind, visibility, status, position}'
```

只看待审核的：

```bash
curl -sS -H "Authorization: Bearer $KEY" "$BASE/api/admin/cards" \
  | jq -r '.data.cards[] | select(.status=="pending") | "\(.id)\t\(.title)"'
```

### 4.2 创建一张根层容器卡

```bash
curl -sS -X POST "$BASE/api/admin/cards" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{
    "title": "常用工具",
    "subtitle": "点这里 **下载**，或看 [官网](https://example.com)",
    "kind": "container",
    "visibility": "public",
    "w": 2, "h": 1
  }' | jq '.data.card'
```

### 4.3 在它里面建子卡片（套娃）

```bash
PARENT=$(curl -sS -H "Authorization: Bearer $KEY" "$BASE/api/admin/cards" | jq -r '.data.cards[] | select(.title=="常用工具") | .id')

curl -sS -X POST "$BASE/api/admin/cards" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "{\"title\":\"网络工具\",\"parentId\":\"$PARENT\",\"kind\":\"container\",\"visibility\":\"login\"}" \
  | jq '.data.card.id'
```

### 4.4 插到两张卡片中间

```bash
# 在「网络工具」前面插一张
TARGET=$(curl -sS -H "Authorization: Bearer $KEY" "$BASE/api/admin/cards" | jq -r '.data.cards[] | select(.title=="网络工具") | .id')

curl -sS -X POST "$BASE/api/admin/cards" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "{\"title\":\"插到前面\",\"insertBeforeId\":\"$TARGET\"}" | jq '.data.card.position, .data.card.parentId'
```

### 4.5 外链卡 / 资源卡

```bash
curl -sS -X POST "$BASE/api/admin/cards" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"title":"官方群","kind":"redirect","redirectUrl":"https://qm.qq.com/xxx","visibility":"public"}'

curl -sS -X POST "$BASE/api/admin/cards" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"title":"本站资源","kind":"resources","visibility":"invite"}'
```

### 4.6 改可见度 / 改名 / 改尺寸

```bash
CARD=<卡片 id>

curl -sS -X PATCH "$BASE/api/admin/cards/$CARD" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"visibility":"staff","title":"内部资料","w":3,"h":2}' | jq '.data.card'
```

### 4.7 调整顺序

```bash
# 同层上移 / 下移
curl -sS -X POST "$BASE/api/admin/cards/$CARD/move" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"direction":"up"}' | jq '.data.card.position'

# 或者直接指定排序位
curl -sS -X PATCH "$BASE/api/admin/cards/$CARD" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"position":0}' > /dev/null
```

### 4.8 审核（站长）

```bash
curl -sS -X POST "$BASE/api/admin/cards/$CARD/review" \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"decision":"approve"}' | jq '.data.card.status'   # approved
```

### 4.9 删除（子卡片会一起删掉）

```bash
curl -sS -X DELETE "$BASE/api/admin/cards/$CARD" -H "Authorization: Bearer $KEY"
```

---

## 5. 完整脚本：把一份 JSON 清单同步成卡片（幂等）

思路：**先 GET 全量 → 按标题+父级匹配 → 有则 PATCH、无则 POST**，重复跑不会重复建卡。

### 5.1 Bash + jq

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-https://community.yanyn.cn}
KEY=${KEY:?请先 export KEY=ycomm_...}

api() { curl -sS -H "Authorization: Bearer $KEY" -H 'content-type: application/json' "$@"; }

# 全量卡片：title|parentId -> id
declare -A INDEX
refresh_index() {
  INDEX=()
  while IFS=$'\t' read -r id title parent; do
    INDEX["$title|$parent"]=$id
  done < <(api "$BASE/api/admin/cards" | jq -r '.data.cards[] | [.id,.title,(.parentId//"")] | @tsv')
}

# 幂等建卡：存在则改，不存在则建；回显 id
upsert_card() {
  local title=$1 parent=${2:-} payload=$3
  refresh_index
  local existing=${INDEX["$title|$parent"]:-}
  if [[ -n "$existing" ]]; then
    api -X PATCH "$BASE/api/admin/cards/$existing" -d "$payload" > /dev/null
    echo "$existing"
  else
    api -X POST "$BASE/api/admin/cards" \
      -d "$(jq -c --arg t "$title" --arg p "$parent" '. + {title:$t} + (if $p=="" then {} else {parentId:$p} end)' <<<"$payload")" \
      | jq -r '.data.card.id'
  fi
}

# —— 用起来 ——
ROOT=$(upsert_card "常用工具" "" '{"subtitle":"[官网](https://example.com)","kind":"container","visibility":"public","w":2}')
SUB=$(upsert_card "网络工具" "$ROOT" '{"kind":"container","visibility":"login"}')
upsert_card "代理客户端" "$SUB" '{"kind":"resources","visibility":"invite"}'

echo "root=$ROOT sub=$SUB"
```

### 5.2 PowerShell（Windows 本地跑很方便）

```powershell
$Base = 'https://community.yanyn.cn'
$Key  = $env:YCOMM_KEY   # 先 setx YCOMM_KEY "ycomm_..."
$Headers = @{ Authorization = "Bearer $Key" }

function Get-Cards {
  (Invoke-RestMethod -Uri "$Base/api/admin/cards" -Headers $Headers).data.cards
}

function Upsert-Card {
  param([string]$Title, [string]$ParentId, [hashtable]$Patch)
  $existing = Get-Cards | Where-Object { $_.title -eq $Title -and ($_.parentId ?? '') -eq ($ParentId ?? '') } | Select-Object -First 1
  $body = @{ title = $Title } + $Patch
  if ($ParentId) { $body.parentId = $ParentId }

  if ($existing) {
    Invoke-RestMethod -Method Patch -Uri "$Base/api/admin/cards/$($existing.id)" -Headers $Headers `
      -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) | Out-Null
    return $existing.id
  }
  $created = Invoke-RestMethod -Method Post -Uri "$Base/api/admin/cards" -Headers $Headers `
    -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress)
  return $created.data.card.id
}

$root = Upsert-Card -Title '常用工具' -Patch @{ subtitle = '[官网](https://example.com)'; kind = 'container'; w = 2 }
$sub  = Upsert-Card -Title '网络工具' -ParentId $root -Patch @{ kind = 'container'; visibility = 'login' }
Upsert-Card -Title '代理客户端' -ParentId $sub -Patch @{ kind = 'resources'; visibility = 'invite' }
"root=$root sub=$sub"
```

### 5.3 Python

```python
import os, requests

BASE = os.environ.get("BASE", "https://community.yanyn.cn")
KEY = os.environ["YCOMM_KEY"]                      # 站长密钥
S = requests.Session()
S.headers.update({"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})


def cards():
    return S.get(f"{BASE}/api/admin/cards", timeout=20).json()["data"]["cards"]


def upsert(title, parent_id=None, **patch):
    """按 标题+父级 幂等建/改卡片，返回卡片 id。"""
    for card in cards():
        if card["title"] == title and (card["parentId"] or None) == (parent_id or None):
            r = S.patch(f"{BASE}/api/admin/cards/{card['id']}", json=patch, timeout=20)
            r.raise_for_status()
            return card["id"]

    body = {"title": title, **patch}
    if parent_id:
        body["parentId"] = parent_id
    r = S.post(f"{BASE}/api/admin/cards", json=body, timeout=20)
    if r.status_code >= 400:
        raise SystemExit(f"创建失败 {r.status_code}: {r.text}")
    return r.json()["data"]["card"]["id"]


if __name__ == "__main__":
    root = upsert("常用工具", subtitle="[官网](https://example.com)", kind="container", w=2)
    sub = upsert("网络工具", parent_id=root, kind="container", visibility="login")
    leaf = upsert("代理客户端", parent_id=sub, kind="resources", visibility="invite")
    print(root, sub, leaf)

    # 批量审核（站长）
    for card in cards():
        if card["status"] == "pending":
            S.post(f"{BASE}/api/admin/cards/{card['id']}/review", json={"decision": "approve"}, timeout=20)
```

### 5.4 Node.js（18+ 自带 fetch）

```js
const BASE = process.env.BASE ?? 'https://community.yanyn.cn';
const KEY = process.env.YCOMM_KEY;               // 站长密钥
const headers = { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    const issues = json?.error?.meta?.issues;
    throw new Error(`${res.status} ${json?.error?.code ?? ''} ${issues ? JSON.stringify(issues, null, 2) : ''}`);
  }
  return json.data;
}

const listCards = () => api('/api/admin/cards').then((d) => d.cards);

async function upsert(title, patch = {}, parentId = null) {
  const all = await listCards();
  const hit = all.find((c) => c.title === title && (c.parentId ?? null) === parentId);
  if (hit) return (await api(`/api/admin/cards/${hit.id}`, { method: 'PATCH', body: JSON.stringify(patch) })).card.id;
  const body = JSON.stringify({ title, ...patch, ...(parentId ? { parentId } : {}) });
  return (await api('/api/admin/cards', { method: 'POST', body })).card.id;
}

const root = await upsert('常用工具', { subtitle: '[官网](https://example.com)', kind: 'container', w: 2 });
const sub = await upsert('网络工具', { kind: 'container', visibility: 'login' }, root);
await upsert('代理客户端', { kind: 'resources', visibility: 'invite' }, sub);
console.log({ root, sub });
```

---

## 6. 常见坑速查

1. **建完看不到**：管理员建的卡片是 `pending`；要么用**站长密钥**建，要么让站长调 `review`。
2. **简介被截断/报 400**：`subtitle` 上限 **200 字**；长内容请放进卡片里的资源或外链。
3. **简介怎么写链接**：直接 Markdown —— `[文字](https://…)`；不再需要旧的「简介跳转链接」字段。
4. **套娃层级**：`parentId` 指向一张 `kind=container` 的卡片才有意义（`redirect`/`resources` 卡里放子卡片前台不会展示）。
5. **删除风险**：`DELETE` 一张父卡片会**级联删除**它下面的所有子卡片。
6. **顺序**：同层排序看 `position`（越小越前）；`insertBeforeId` 只影响创建那一刻，之后的顺序用 `move` 或 `PATCH position`。
7. **只读密钥**：勾了「只读」的 key 只能 `GET`，创建/修改/删除会返回 403 —— 适合给只读的监控/展示脚本。
8. **不要混用**：请求带 Bearer 时不要再带 Cookie；反过来也一样。
9. **想确认 key 是哪把**：后台列表显示前缀（`ycomm_ab12cd34…`）和「最近使用时间」。

---

## 7. 健康检查与自测

```bash
curl -sS "$BASE/api/health" | jq                     # 站点存活
curl -sS -H "Authorization: Bearer $KEY" "$BASE/api/auth/me" | jq '.data.user | {username, role}'
```

`role` 必须是 `owner`；否则说明这把 key 归属的账号已经不是站长了（转让后旧 key 会自动失效）。

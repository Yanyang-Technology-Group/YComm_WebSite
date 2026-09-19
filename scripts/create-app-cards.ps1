<#
.SYNOPSIS
  交互式创建「社区客户端APP」下载卡片树（需要站长的 API 密钥）。

.DESCRIPTION
  生成的卡片结构（层级与前台点击路径一致）：

    社区客户端APP                      (container, 公开)
      ├── Windows                      (container)
      │     └── 1.0.0                  (container, 简介里列出全部下载链接)
      │           ├── App-1.0.0.exe    (redirect → 外链)
      │           └── App-1.0.0.zip    (redirect → 外链)
      ├── Linux
      │     └── 1.0.0
      │           ├── App-1.0.0.deb
      │           └── App-1.0.0.tar.gz
      └── Android
            └── 1.0.0
                  ├── App-1.0.0.apk
                  └── App-1.0.0.aab

  特点：
  - 幂等：同名同层卡片已存在就复用/更新，不会重复创建；补全缺失的文件卡。
  - 留空的文件直接跳过，整平台都留空就不创建那个平台卡片。
  - 文件卡标题自动取外链的文件名（取不到就用「扩展名 下载」）。
  - -DryRun 只打印计划，不写任何数据。

.EXAMPLE
  # Windows 上一键运行（推荐；会自动绕过脚本执行策略限制）
  scripts\create-app-cards.cmd

.EXAMPLE
  # 手动跑 PowerShell
  pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/create-app-cards.ps1
  # 若报「running scripts is disabled」，就是执行策略拦的，加上 -ExecutionPolicy Bypass 即可

.EXAMPLE
  # 非交互（CI / 脚本里用）
  $env:YCOMM_KEY = 'ycomm_...'
  pwsh -ExecutionPolicy Bypass -File scripts/create-app-cards.ps1 -Token $env:YCOMM_KEY -Version 1.0.0 -Links @{
    'Windows.exe'     = 'https://dl.example.com/App-1.0.0.exe'
    'Windows.zip'     = 'https://dl.example.com/App-1.0.0.zip'
    'Android.apk'     = 'https://dl.example.com/App-1.0.0.apk'
    'Linux.deb'       = ''    # 传空字符串 = 明确跳过，不会停下来问
  }

.EXAMPLE
  # 先看看会建哪些卡片，不真的写
  pwsh -ExecutionPolicy Bypass -File scripts/create-app-cards.ps1 -DryRun
#>
[CmdletBinding()]
param(
  # 站点地址（末尾斜杠可有可无）
  [string]$BaseUrl = 'https://community.yanyn.cn',

  # 根卡片名称
  [string]$AppName = '社区客户端APP',

  # 站长 API 密钥；不传则交互式输入（隐藏显示）
  [string]$Token,

  # 版本号；不传则交互式输入
  [string]$Version,

  # 预填外链，键名形如 'Windows.exe' / 'Linux.tar.gz' / 'Android.apk'
  [hashtable]$Links,

  # 只打印计划，不写入
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# 平台与文件类型（改这里就能增减平台/后缀）
# ---------------------------------------------------------------------------
$Platforms = @(
  [pscustomobject]@{ Name = 'Windows'; Files = @('.exe', '.zip') },
  [pscustomobject]@{ Name = 'Linux'; Files = @('.deb', '.tar.gz') },
  [pscustomobject]@{ Name = 'Android'; Files = @('.apk', '.aab') }
)

# ===========================================================================
# 纯函数（方便单独测试；不碰网络）
# ===========================================================================

<# 看起来像文件名吗（末段带扩展名，如 YComm-1.0.0.exe / 安装包.apk）。 #>
function Test-FileName {
  param([string]$Name)
  if ([string]::IsNullOrWhiteSpace($Name)) { return $false }
  return [bool]($Name -match '^[^/\\]+\.[A-Za-z0-9]{1,8}$')
}

<#
  从外链里取文件名：
  1) 优先 URL 路径末段（去 query/fragment，URL 解码），但必须「看起来像文件名」；
  2) 否则从 query 里找 file= / filename= / name= 参数；
  3) 都没有就返回 $null，调用方回退到「版本号+后缀 下载」。
#>
function Get-FileNameFromUrl {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return $null }
  $clean = $Url.Trim()

  $query = ''
  if ($clean -match '\?([^#]*)$') { $query = $Matches[1] }
  $path = (($clean -split '[?#]')[0]).TrimEnd('/')
  $leaf = ''
  if ($path -and $path.Contains('/')) {
    $leaf = [System.Uri]::UnescapeDataString(($path -split '/')[-1])
  }
  if (Test-FileName -Name $leaf) { return $leaf }

  foreach ($pair in ($query -split '&')) {
    if ($pair -match '^(?:file|filename|name)=(.+)$') {
      $candidate = [System.Uri]::UnescapeDataString($Matches[1])
      if (Test-FileName -Name $candidate) { return $candidate }
    }
  }
  return $null
}

<# 生成文件名卡的标题：优先用外链里的真实文件名，否则「版本号+后缀 下载」。 #>
function Get-FileCardTitle {
  param([string]$Url, [string]$Extension, [string]$AppVersion)
  $name = Get-FileNameFromUrl -Url $Url
  if ($name) { return $name }
  return "$AppVersion$Extension 下载"
}

<# 版本卡片的简介：把该版本所有下载链接写成 Markdown 列表。 #>
function Build-VersionSubtitle {
  param([string]$AppVersion, [array]$FileLinks)
  $lines = @("**$AppVersion** 下载：")
  foreach ($item in $FileLinks) {
    $title = Get-FileCardTitle -Url $item.Url -Extension $item.Extension -AppVersion $AppVersion
    $lines += "- [$title]($($item.Url))"
  }
  return ($lines -join "`n")
}

<# 基本校验：必须是 http(s) 外链。 #>
function Test-HttpUrl {
  param([string]$Url)
  if ([string]::IsNullOrWhiteSpace($Url)) { return $false }
  return [bool]($Url.Trim() -match '^https?://\S+$')
}

# ===========================================================================
# 交互输入
# ===========================================================================

<# 隐藏输入（密钥不回显）。 #>
function Read-Secret {
  param([string]$Prompt)
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Resolve-Links {
  param([string]$AppVersion, [hashtable]$PresetLinks)

  Write-Host ''
  Write-Host '请逐个粘贴下载外链（http/https）。没有的文件直接回车跳过。' -ForegroundColor Cyan
  Write-Host ''

  $collected = @()
  foreach ($platform in $Platforms) {
    $platformFiles = @()
    foreach ($ext in $platform.Files) {
      $key = "$($platform.Name)$ext"
      # 注意：PowerShell 变量名不区分大小写，预设值变量不能叫 $preset（会覆盖参数 $PresetLinks）。
      # 传了预设就以预设为准：传空字符串 = 明确跳过（CI 里不会卡在提问上）。
      $hasPreset = $PresetLinks -and $PresetLinks.ContainsKey($key)
      $answer = $null
      if ($hasPreset) {
        $answer = [string]$PresetLinks[$key]
      } else {
        $answer = Read-Host ("  {0,-7} {1,-8} 外链" -f $platform.Name, $ext)
      }

      if ([string]::IsNullOrWhiteSpace($answer)) { continue }
      if (-not (Test-HttpUrl -Url $answer)) {
        Write-Warning "「$answer」不是 http/https 链接，已跳过 $key"
        continue
      }
      $platformFiles += [pscustomobject]@{ Extension = $ext; Url = $answer.Trim() }
    }
    if ($platformFiles.Count -gt 0) {
      $collected += [pscustomobject]@{ Platform = $platform.Name; Files = $platformFiles }
    }
  }
  return $collected
}

# ===========================================================================
# HTTP
# ===========================================================================

<# 从异常里尽量挖出服务端返回的响应体（400 时 error.meta.issues 才是真正原因）。 #>
function Get-ErrorResponseBody {
  param($ErrorRecord)

  # PowerShell 7 / 5.1 常见位置
  $body = $ErrorRecord.ErrorDetails.Message
  if (-not [string]::IsNullOrWhiteSpace($body)) { return $body }

  # 退路：直接读响应流（5.1 里 ErrorDetails 有时是空的）
  try {
    $response = $ErrorRecord.Exception.Response
    if ($response) {
      $stream = $response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
      }
    }
  } catch {
    # 读不到就算了，下面退回 Exception.Message
  }
  return $null
}

<# 把服务端错误整理成人能看的一行（含 meta.issues 的字段名与原因）。 #>
function Format-ApiError {
  param([string]$Method, [string]$Path, $ErrorRecord)

  $body = Get-ErrorResponseBody -ErrorRecord $ErrorRecord
  if ([string]::IsNullOrWhiteSpace($body)) {
    return "请求 $Method $Path 失败：$($ErrorRecord.Exception.Message)"
  }

  try {
    $parsed = $body | ConvertFrom-Json
    $issues = $parsed.error.meta.issues
    if ($issues) {
      $lines = @()
      foreach ($issue in $issues) {
        $lines += ("      - {0}: {1}" -f $issue.path, $issue.message)
      }
      return ("请求 {0} {1} 失败：{2}（{3}）`n{4}" -f `
        $Method, $Path, $parsed.error.code, $parsed.error.message, ($lines -join "`n"))
    }
    if ($parsed.error.code) {
      return ("请求 {0} {1} 失败：{2}（{3}）`n    {4}" -f $Method, $Path, $parsed.error.code, $parsed.error.message, $body)
    }
  } catch {
    # 不是 JSON 就原样带出来
  }
  return "请求 $Method $Path 失败：$body"
}

function Invoke-YcommApi {
  param(
    [Parameter(Mandatory)][string]$Method,
    [Parameter(Mandatory)][string]$Path,
    $Body
  )
  $params = @{
    Method     = $Method
    Uri        = ($BaseUrl.TrimEnd('/') + $Path)
    Headers    = @{ Authorization = "Bearer $Token" }
    TimeoutSec = 30
  }
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    # 关键：把 JSON 转成 UTF-8 字节再发。
    # Windows PowerShell 5.1 用 -Body <string> 时会按 ANSI 编码发送，
    # 中文（社区客户端APP…）会变成非法字节 → 服务端 JSON 解析失败 → 400。
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    throw (Format-ApiError -Method $Method -Path $Path -ErrorRecord $_)
  }
}

# ===========================================================================
# 卡片树（幂等 upsert）
# ===========================================================================

$script:CardIndex = @{}

function Get-IndexKey {
  param([string]$Title, [string]$ParentId)
  if ([string]::IsNullOrEmpty($ParentId)) { return "$Title|" }
  return "$Title|$ParentId"
}

function Update-CardIndex {
  $script:CardIndex = @{}
  $all = (Invoke-YcommApi -Method Get -Path '/api/admin/cards').data.cards
  foreach ($card in $all) {
    $script:CardIndex[(Get-IndexKey -Title $card.title -ParentId $card.parentId)] = $card
  }
}

function Find-LocalCard {
  param([string]$Title, [string]$ParentId)
  $key = Get-IndexKey -Title $Title -ParentId $ParentId
  if ($script:CardIndex.ContainsKey($key)) { return $script:CardIndex[$key] }
  return $null
}

<#
  确保存在一张卡片：不存在则创建，存在则（可选）更新。
  返回卡片 id；-DryRun 时返回占位 id 以便继续打印计划。
#>
function Save-Card {
  param(
    [Parameter(Mandatory)][string]$Title,
    [string]$ParentId,
    [hashtable]$Fields,
    [switch]$NoUpdate
  )

  if ($null -eq $Fields) { $Fields = @{} }
  $existing = Find-LocalCard -Title $Title -ParentId $ParentId

  if ($existing) {
    if ($NoUpdate) {
      Write-Host ("    复用   {0}" -f $Title) -ForegroundColor DarkGray
      return $existing.id
    }
    if ($DryRun) {
      Write-Host ("    更新   {0}（id {1}）" -f $Title, $existing.id) -ForegroundColor Yellow
      return $existing.id
    }
    $body = @{ title = $Title }
    foreach ($k in $Fields.Keys) { $body[$k] = $Fields[$k] }
    $result = Invoke-YcommApi -Method Patch -Path "/api/admin/cards/$($existing.id)" -Body $body
    Write-Host ("    更新   {0}" -f $Title) -ForegroundColor Yellow
    $script:CardIndex[(Get-IndexKey -Title $Title -ParentId $ParentId)] = $result.data.card
    return $result.data.card.id
  }

  if ($DryRun) {
    Write-Host ("    新建   {0}" -f $Title) -ForegroundColor Green
    return "<dry-run:$Title>"
  }

  $body = @{ title = $Title }
  if ($ParentId) { $body.parentId = $ParentId }
  foreach ($k in $Fields.Keys) { $body[$k] = $Fields[$k] }
  $created = Invoke-YcommApi -Method Post -Path '/api/admin/cards' -Body $body
  Write-Host ("    新建   {0}" -f $Title) -ForegroundColor Green
  $script:CardIndex[(Get-IndexKey -Title $Title -ParentId $ParentId)] = $created.data.card
  return $created.data.card.id
}

# ===========================================================================
# 主流程
# ===========================================================================

function Invoke-Main {
  Write-Host ''
  Write-Host '=== 社区客户端APP 卡片创建器 ===' -ForegroundColor Cyan
  Write-Host "站点：$BaseUrl"
  Write-Host ("PowerShell：{0}（{1}）" -f $PSVersionTable.PSVersion, $PSVersionTable.PSEdition)
  if ($DryRun) { Write-Host '模式：DryRun（只打印计划，不写入）' -ForegroundColor Yellow }

  # 1) 密钥
  if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = Read-Secret -Prompt '请粘贴站长 API 密钥（输入时不显示）'
  }
  if ([string]::IsNullOrWhiteSpace($Token)) { throw '没有拿到 API 密钥，已退出。' }

  $me = (Invoke-YcommApi -Method Get -Path '/api/auth/me').data.user
  Write-Host ("身份：{0}（{1}）" -f $me.username, $me.role) -ForegroundColor Green
  if ($me.role -ne 'owner') {
    Write-Warning '这把密钥不是站长：创建的卡片会是「待站长审核」状态，前台暂时看不到。'
  }

  # 2) 版本号
  if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = Read-Host '版本号（例如 1.0.0）'
  }
  $Version = $Version.Trim()
  if ([string]::IsNullOrWhiteSpace($Version)) { throw '版本号不能为空，已退出。' }

  # 3) 外链
  $platformLinks = Resolve-Links -AppVersion $Version -PresetLinks $Links
  if ($platformLinks.Count -eq 0) { throw '一个外链都没填，已退出。' }

  # 4) 计划预览
  Write-Host ''
  Write-Host '将要创建/更新的结构：' -ForegroundColor Cyan
  Write-Host ("  {0}" -f $AppName)
  foreach ($platform in $platformLinks) {
    Write-Host ("    └ {0}" -f $platform.Platform)
    Write-Host ("        └ {0}" -f $Version)
    foreach ($file in $platform.Files) {
      $title = Get-FileCardTitle -Url $file.Url -Extension $file.Extension -AppVersion $Version
      Write-Host ("            ├ {0}  →  {1}" -f $title, $file.Url)
    }
  }

  # 5) 写入
  Write-Host ''
  Write-Host '开始写入：' -ForegroundColor Cyan
  Update-CardIndex

  $appId = Save-Card -Title $AppName -ParentId '' -Fields @{ kind = 'container'; visibility = 'public'; w = 2; h = 1 }
  Write-Host ("  {0}" -f $AppName) -ForegroundColor White

  foreach ($platform in $platformLinks) {
    Write-Host ("  {0}" -f $platform.Platform) -ForegroundColor White
    $platformId = Save-Card -Title $platform.Platform -ParentId $appId -Fields @{ kind = 'container'; visibility = 'public' }

    $subtitle = Build-VersionSubtitle -AppVersion $Version -FileLinks $platform.Files
    $versionId = Save-Card -Title $Version -ParentId $platformId -Fields @{
      kind       = 'container'
      visibility = 'public'
      subtitle   = $subtitle
    }

    foreach ($file in $platform.Files) {
      $fileTitle = Get-FileCardTitle -Url $file.Url -Extension $file.Extension -AppVersion $Version
      Save-Card -Title $fileTitle -ParentId $versionId -Fields @{
        kind        = 'redirect'
        visibility  = 'public'
        redirectUrl = $file.Url
        subtitle    = "$Version $($file.Extension) 安装包"
      } | Out-Null
    }
  }

  Write-Host ''
  if ($DryRun) {
    Write-Host 'DryRun 结束：什么都没有写入。去掉 -DryRun 即会真正创建。' -ForegroundColor Yellow
  } else {
    Write-Host '完成！前台位置：' -NoNewline
    Write-Host ("{0}/downloads" -f $BaseUrl.TrimEnd('/')) -ForegroundColor Green
    if ($me.role -ne 'owner') {
      Write-Host '注意：管理员创建的卡片需要站长在「管理后台 → 下载区卡片」通过审核后才对外可见。' -ForegroundColor Yellow
    }
  }
}

# 直接运行才执行主流程；用 `. ./create-app-cards.ps1` 点源进来只会加载上面的函数（便于测试）
if ($MyInvocation.InvocationName -ne '.') {
  Invoke-Main
}

param(
  [Parameter(Position = 0)][ValidateSet("configure", "show", "validate", "start", "stop")][string]$Command = "show",
  [string]$DataRoot,
  [string]$CoreRoot,
  [string]$ProfileName = "local-main"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RuntimeLocalDir = Join-Path $RepoRoot "runtime\local"
$ProfilePath = Join-Path $RuntimeLocalDir "runtime-profile.json"
$ProcessesPath = Join-Path $RuntimeLocalDir "processes.json"
$ForbiddenProfileFields = @(
  "apiKey", "authorization", "bearerToken", "headers", "secret", "password",
  "command", "commands", "executable", "argument", "arguments", "arg", "args",
  "provider", "body", "chat", "content", "note"
)

function Write-Info {
  param([string]$Message)
  Write-Output "[pkos-local-runtime] $Message"
}

function Fail-Code {
  param([string]$Code, [string]$Message = "")
  if ($Message) {
    Write-Output "$Code $Message"
  } else {
    Write-Output $Code
  }
  exit 1
}

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) {
    Fail-Code "INVALID_PATH" "empty path"
  }
  return [System.IO.Path]::GetFullPath($Path)
}

function Normalize-RuntimePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $full = [System.IO.Path]::GetFullPath($Path).Replace("\", "/").TrimEnd("/")
  return $full.ToLowerInvariant()
}

function Get-Sha256 {
  param([Parameter(Mandatory = $true)][string]$Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") }) -join "")
  } finally {
    $sha.Dispose()
  }
}

function Get-RuntimeFingerprint {
  param([string]$ResolvedCoreRoot, [string]$ResolvedDataRoot, [string]$AgentDbPath)
  return (Get-Sha256 ((Normalize-RuntimePath $ResolvedCoreRoot) + "`n" + (Normalize-RuntimePath $ResolvedDataRoot) + "`n" + (Normalize-RuntimePath $AgentDbPath))).Substring(0, 16)
}

function Assert-CoreRoot {
  param([string]$ResolvedCoreRoot)
  foreach ($required in @("apps", "tools", "docs")) {
    if (-not (Test-Path (Join-Path $ResolvedCoreRoot $required))) {
      Fail-Code "INVALID_CORE_ROOT" "missing $required under $ResolvedCoreRoot"
    }
  }
}

function Assert-DataRoot {
  param([string]$ResolvedDataRoot)
  if ([string]::IsNullOrWhiteSpace($ResolvedDataRoot)) {
    Fail-Code "PKOS_DATA_ROOT_REQUIRED"
  }
  $lower = (Normalize-RuntimePath $ResolvedDataRoot)
  if ($lower.Contains("/node_modules") -or $lower.EndsWith("/dist") -or $lower.Contains("/dist/")) {
    Fail-Code "INVALID_DATA_ROOT" "data root cannot point at node_modules or dist"
  }
  if (-not (Test-Path $ResolvedDataRoot)) {
    Fail-Code "PKOS_DATA_ROOT_NOT_FOUND" $ResolvedDataRoot
  }
}

function Read-Profile {
  if (-not (Test-Path $ProfilePath)) {
    return $null
  }
  $profile = Get-Content -Raw $ProfilePath | ConvertFrom-Json
  Assert-ProfileSafe $profile
  return $profile
}

function Assert-ProfileSafe {
  param($Profile)
  $json = $Profile | ConvertTo-Json -Depth 40
  foreach ($field in $ForbiddenProfileFields) {
    if ($json -match ('"' + [Regex]::Escape($field) + '"\s*:')) {
      Fail-Code "RUNTIME_PROFILE_FORBIDDEN_FIELD" $field
    }
  }
}

function Resolve-RuntimeConfig {
  param([string]$CommandDataRoot, [string]$CommandCoreRoot)
  $profile = Read-Profile
  $coreSource = "inferred"
  $dataSource = $null

  if (-not [string]::IsNullOrWhiteSpace($CommandCoreRoot)) {
    $resolvedCoreRoot = Resolve-FullPath $CommandCoreRoot
    $coreSource = "argument"
  } elseif (-not [string]::IsNullOrWhiteSpace($env:PKOS_CORE_ROOT)) {
    $resolvedCoreRoot = Resolve-FullPath $env:PKOS_CORE_ROOT
    $coreSource = "environment"
  } elseif ($profile -and $profile.coreRoot) {
    $resolvedCoreRoot = Resolve-FullPath $profile.coreRoot
    $coreSource = "profile"
  } else {
    $resolvedCoreRoot = Resolve-FullPath $RepoRoot
  }

  if (-not [string]::IsNullOrWhiteSpace($CommandDataRoot)) {
    $resolvedDataRoot = Resolve-FullPath $CommandDataRoot
    $dataSource = "argument"
  } elseif (-not [string]::IsNullOrWhiteSpace($env:PKOS_DATA_ROOT)) {
    $resolvedDataRoot = Resolve-FullPath $env:PKOS_DATA_ROOT
    $dataSource = "environment"
  } elseif ($profile -and $profile.dataRoot) {
    $resolvedDataRoot = Resolve-FullPath $profile.dataRoot
    $dataSource = "profile"
  } else {
    Fail-Code "PKOS_DATA_ROOT_REQUIRED"
  }

  Assert-CoreRoot $resolvedCoreRoot
  Assert-DataRoot $resolvedDataRoot
  $agentPort = if ($profile -and $profile.ports -and $profile.ports.agentServer) { [int]$profile.ports.agentServer } else { 8790 }
  $webPort = if ($profile -and $profile.ports -and $profile.ports.webDashboard) { [int]$profile.ports.webDashboard } else { 5173 }
  $startWebDashboard = if ($profile -and $profile.start -and $null -ne $profile.start.webDashboard) { [bool]$profile.start.webDashboard } else { $false }
  $startDesktop = if ($profile -and $profile.start -and $null -ne $profile.start.desktop) { [bool]$profile.start.desktop } else { $false }
  $agentDbPath = Join-Path $resolvedDataRoot "runtime\agent\agent.sqlite"
  $fingerprint = Get-RuntimeFingerprint $resolvedCoreRoot $resolvedDataRoot $agentDbPath
  return [PSCustomObject]@{
    Profile = $profile
    ProfileName = if ($profile -and $profile.profileName) { [string]$profile.profileName } else { $ProfileName }
    CoreRoot = $resolvedCoreRoot
    CoreSource = $coreSource
    DataRoot = $resolvedDataRoot
    DataSource = $dataSource
    AgentDbPath = $agentDbPath
    AgentPort = $agentPort
    WebPort = $webPort
    StartWebDashboard = $startWebDashboard
    StartDesktop = $startDesktop
    RuntimeFingerprint = $fingerprint
    DataRootFingerprint = (Get-Sha256 (Normalize-RuntimePath $resolvedDataRoot)).Substring(0, 16)
  }
}

function Configure-Profile {
  $resolvedCoreRoot = Resolve-FullPath $(if ($CoreRoot) { $CoreRoot } else { $RepoRoot })
  Assert-CoreRoot $resolvedCoreRoot
  if ([string]::IsNullOrWhiteSpace($DataRoot)) {
    Fail-Code "PKOS_DATA_ROOT_REQUIRED"
  }
  $resolvedDataRoot = Resolve-FullPath $DataRoot
  $lower = Normalize-RuntimePath $resolvedDataRoot
  if ($lower.Contains("/node_modules") -or $lower.EndsWith("/dist") -or $lower.Contains("/dist/")) {
    Fail-Code "INVALID_DATA_ROOT" $resolvedDataRoot
  }
  New-Item -ItemType Directory -Force -Path $resolvedDataRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $RuntimeLocalDir | Out-Null
  $profile = [ordered]@{
    schemaVersion = "0.6"
    profileName = $ProfileName
    coreRoot = $resolvedCoreRoot
    dataRoot = $resolvedDataRoot
    ports = [ordered]@{
      agentServer = 8790
      webDashboard = 5173
    }
    start = [ordered]@{
      webDashboard = $true
      desktop = $true
    }
  }
  $profile | ConvertTo-Json -Depth 20 | Set-Content -Path $ProfilePath -Encoding UTF8
  Write-Info "RUNTIME_PROFILE_CONFIGURED $ProfilePath"
}

function Show-Runtime {
  $config = Resolve-RuntimeConfig $DataRoot $CoreRoot
  Write-Info "profileName $($config.ProfileName)"
  Write-Info "coreRoot $($config.CoreRoot)"
  Write-Info "dataRoot $($config.DataRoot)"
  Write-Info "agentDbPath $($config.AgentDbPath)"
  Write-Info "agentServerPort $($config.AgentPort)"
  Write-Info "webDashboardPort $($config.WebPort)"
  Write-Info "startWebDashboard $($config.StartWebDashboard)"
  Write-Info "startDesktop $($config.StartDesktop)"
  Write-Info "dbExists $(Test-Path $config.AgentDbPath)"
  Write-Info "runtimeFingerprint $($config.RuntimeFingerprint)"
  if ((Normalize-RuntimePath $config.CoreRoot) -eq (Normalize-RuntimePath $config.DataRoot)) {
    Write-Info "warning CORE_ROOT_EQUALS_DATA_ROOT"
  }
}

function Test-PortListener {
  param([int]$Port)
  return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-RuntimeInfoFromPort {
  param([int]$Port)
  try {
    return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$Port/api/runtime-info" -TimeoutSec 2
  } catch {
    return $null
  }
}

function Start-LocalRuntime {
  $config = Resolve-RuntimeConfig $DataRoot $CoreRoot
  New-Item -ItemType Directory -Force -Path (Split-Path $config.AgentDbPath -Parent) | Out-Null
  $listener = Test-PortListener $config.AgentPort
  if ($listener) {
    $runtimeInfo = Get-RuntimeInfoFromPort $config.AgentPort
    if ($runtimeInfo -and $runtimeInfo.runtimeFingerprint -eq $config.RuntimeFingerprint) {
      Write-Info "AGENT_SERVER_ALREADY_RUNNING_SAME_RUNTIME $($config.RuntimeFingerprint)"
      return
    }
    Write-Output "AGENT_SERVER_RUNTIME_MISMATCH expected=$($config.RuntimeFingerprint) actual=$($runtimeInfo.runtimeFingerprint) pid=$($listener.OwningProcess)"
    exit 1
  }

  $env:PKOS_CORE_ROOT = $config.CoreRoot
  $env:PKOS_DATA_ROOT = $config.DataRoot
  $env:PKOS_AGENT_DB_PATH = $config.AgentDbPath
  $env:PKOS_RUNTIME_PROFILE_NAME = $config.ProfileName
  $env:PKOS_AGENT_PORT = [string]$config.AgentPort
  $agent = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory (Join-Path $config.CoreRoot "apps\agent-server") -WindowStyle Hidden -PassThru
  Add-ProcessRecord "agent-server" $agent.Id $agent.StartTime $config.RuntimeFingerprint
  Wait-AgentReady $config
  Write-Info "AGENT_SERVER_STARTED pid=$($agent.Id) runtime=$($config.RuntimeFingerprint)"

  if ($config.StartWebDashboard) {
    $webListener = Test-PortListener $config.WebPort
    if (-not $webListener) {
      $web = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory (Join-Path $config.CoreRoot "apps\web-dashboard") -WindowStyle Hidden -PassThru
      Add-ProcessRecord "web-dashboard" $web.Id $web.StartTime $config.RuntimeFingerprint
      Write-Info "WEB_DASHBOARD_STARTED pid=$($web.Id)"
    } else {
      Write-Info "WEB_DASHBOARD_ALREADY_RUNNING pid=$($webListener.OwningProcess)"
    }
  }

  if ($config.StartDesktop) {
    $desktop = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "dev") -WorkingDirectory (Join-Path $config.CoreRoot "apps\desktop") -PassThru
    Add-ProcessRecord "desktop" $desktop.Id $desktop.StartTime $config.RuntimeFingerprint
    Write-Info "DESKTOP_STARTED pid=$($desktop.Id)"
  }
}

function Wait-AgentReady {
  param($Config)
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    $runtimeInfo = Get-RuntimeInfoFromPort $Config.AgentPort
    if ($runtimeInfo -and $runtimeInfo.runtimeFingerprint -eq $Config.RuntimeFingerprint) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  Fail-Code "AGENT_SERVER_START_TIMEOUT"
}

function Read-ProcessRecords {
  if (-not (Test-Path $ProcessesPath)) {
    return @()
  }
  $records = Get-Content -Raw $ProcessesPath | ConvertFrom-Json
  if ($null -eq $records) { return @() }
  if ($records -is [array]) { return $records }
  return @($records)
}

function Write-ProcessRecords {
  param([array]$Records)
  New-Item -ItemType Directory -Force -Path $RuntimeLocalDir | Out-Null
  $Records | ConvertTo-Json -Depth 20 | Set-Content -Path $ProcessesPath -Encoding UTF8
}

function Add-ProcessRecord {
  param([string]$Role, [int]$ProcessId, [datetime]$StartedAt, [string]$RuntimeFingerprint)
  $records = @(Read-ProcessRecords)
  $records += [PSCustomObject]@{
    pid = $ProcessId
    role = $Role
    startedAt = $StartedAt.ToUniversalTime().ToString("o")
    runtimeFingerprint = $RuntimeFingerprint
  }
  Write-ProcessRecords $records
}

function Stop-ProcessTree {
  param([int]$ProcessId)
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree ([int]$child.ProcessId)
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-LocalRuntime {
  $config = Resolve-RuntimeConfig $DataRoot $CoreRoot
  $records = @(Read-ProcessRecords)
  $remaining = @()
  $orderedRecords = @($records | Sort-Object @{ Expression = {
    switch ($_.role) {
      "desktop" { 0 }
      "web-dashboard" { 1 }
      "agent-server" { 2 }
      default { 3 }
    }
  } })
  foreach ($record in $orderedRecords) {
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if (-not $process) {
      Write-Info "PROCESS_NOT_RUNNING pid=$($record.pid)"
      continue
    }
    if ($record.runtimeFingerprint -ne $config.RuntimeFingerprint) {
      Write-Info "PROCESS_IDENTITY_MISMATCH pid=$($record.pid)"
      $remaining += $record
      continue
    }
    $recordStart = [datetime]::Parse($record.startedAt)
    if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $recordStart.ToUniversalTime()).TotalSeconds) -gt 2) {
      Write-Info "PROCESS_IDENTITY_MISMATCH pid=$($record.pid)"
      $remaining += $record
      continue
    }
    Stop-ProcessTree ([int]$record.pid)
    Write-Info "PROCESS_STOPPED role=$($record.role) pid=$($record.pid)"
  }
  Write-ProcessRecords $remaining
}

switch ($Command) {
  "configure" { Configure-Profile }
  "show" { Show-Runtime }
  "validate" { [void](Resolve-RuntimeConfig $DataRoot $CoreRoot); Write-Info "RUNTIME_PROFILE_VALID" }
  "start" { Start-LocalRuntime }
  "stop" { Stop-LocalRuntime }
}

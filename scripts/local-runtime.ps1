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

function ConvertTo-CanonicalJson {
  param($Value)
  if ($null -eq $Value) {
    return "null"
  }
  if ($Value -is [string]) {
    return ($Value | ConvertTo-Json -Compress)
  }
  if ($Value -is [bool]) {
    return $(if ($Value) { "true" } else { "false" })
  }
  if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int] -or $Value -is [long] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) {
    return ($Value | ConvertTo-Json -Compress)
  }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string]) -and -not ($Value -is [System.Collections.IDictionary]) -and -not ($Value -is [pscustomobject])) {
    $items = @()
    foreach ($item in $Value) {
      $items += (ConvertTo-CanonicalJson $item)
    }
    return "[" + ($items -join ",") + "]"
  }
  $properties = @()
  if ($Value -is [System.Collections.IDictionary]) {
    foreach ($key in $Value.Keys) {
      $properties += [PSCustomObject]@{ Name = [string]$key; Value = $Value[$key] }
    }
  } else {
    foreach ($property in $Value.PSObject.Properties) {
      $properties += [PSCustomObject]@{ Name = [string]$property.Name; Value = $property.Value }
    }
  }
  $members = @()
  foreach ($property in @($properties | Sort-Object Name)) {
    $members += (($property.Name | ConvertTo-Json -Compress) + ":" + (ConvertTo-CanonicalJson $property.Value))
  }
  return "{" + ($members -join ",") + "}"
}

function Get-ServiceCapabilityManifestPath {
  return Join-Path $RepoRoot "apps\agent-server\service-capabilities.json"
}

function Read-ServiceCapabilityManifest {
  $manifestPath = Get-ServiceCapabilityManifestPath
  if (-not (Test-Path $manifestPath)) {
    Fail-Code "SERVICE_CAPABILITY_MANIFEST_MISSING"
  }
  $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
  if (-not $manifest.service -or $manifest.service.name -ne "pkos-agent-server") {
    Fail-Code "SERVICE_CAPABILITY_MANIFEST_INVALID" "service.name"
  }
  if (-not $manifest.service.version -or -not $manifest.service.apiContractVersion) {
    Fail-Code "SERVICE_CAPABILITY_MANIFEST_INVALID" "service version/api contract"
  }
  if (-not $manifest.database -or -not $manifest.database.requiredSchemaVersion) {
    Fail-Code "SERVICE_CAPABILITY_MANIFEST_INVALID" "required schema"
  }
  $capabilities = @($manifest.capabilities | ForEach-Object { [string]$_ })
  if ($capabilities.Count -eq 0) {
    Fail-Code "SERVICE_CAPABILITY_MANIFEST_INVALID" "capabilities"
  }
  $uniqueCapabilities = @($capabilities | Sort-Object -Unique)
  if ($uniqueCapabilities.Count -ne $capabilities.Count) {
    Fail-Code "SERVICE_CAPABILITY_MANIFEST_INVALID" "duplicate capabilities"
  }
  return [PSCustomObject]@{
    SchemaVersion = [string]$manifest.schemaVersion
    ServiceName = [string]$manifest.service.name
    ServiceVersion = [string]$manifest.service.version
    ApiContractVersion = [string]$manifest.service.apiContractVersion
    RequiredDatabaseSchema = [int]$manifest.database.requiredSchemaVersion
    Capabilities = @($uniqueCapabilities)
  }
}

function Convert-ServiceManifestToCanonicalObject {
  param($Manifest)
  return [ordered]@{
    capabilities = @($Manifest.Capabilities)
    database = [ordered]@{
      requiredSchemaVersion = [int]$Manifest.RequiredDatabaseSchema
    }
    schemaVersion = [string]$Manifest.SchemaVersion
    service = [ordered]@{
      apiContractVersion = [string]$Manifest.ApiContractVersion
      name = [string]$Manifest.ServiceName
      version = [string]$Manifest.ServiceVersion
    }
  }
}

function Get-GitOutput {
  param([array]$Arguments)
  try {
    $output = & git -C $RepoRoot @Arguments 2>$null
    if ($LASTEXITCODE -eq 0) {
      return (($output | Out-String).Trim())
    }
  } catch {
    return $null
  }
  return $null
}

function Get-ServiceSourceRevision {
  if (-not [string]::IsNullOrWhiteSpace($env:PKOS_BUILD_REVISION)) {
    return ([string]$env:PKOS_BUILD_REVISION).Trim()
  }
  $revision = Get-GitOutput -Arguments @("rev-parse", "HEAD")
  if ([string]::IsNullOrWhiteSpace($revision)) {
    return "unknown"
  }
  return $revision
}

function Get-ServiceSourceDirty {
  if (-not [string]::IsNullOrWhiteSpace($env:PKOS_BUILD_DIRTY)) {
    return (([string]$env:PKOS_BUILD_DIRTY).Trim().ToLowerInvariant() -eq "true")
  }
  $status = Get-GitOutput -Arguments @("status", "--porcelain")
  return (-not [string]::IsNullOrWhiteSpace($status))
}

function Get-ServiceBuildIdentity {
  $manifest = Read-ServiceCapabilityManifest
  $canonical = ConvertTo-CanonicalJson (Convert-ServiceManifestToCanonicalObject $manifest)
  $revision = Get-ServiceSourceRevision
  $dirty = Get-ServiceSourceDirty
  $sourceRevision = $revision + $(if ($dirty) { "+dirty" } else { "" })
  return [PSCustomObject]@{
    Name = $manifest.ServiceName
    Version = $manifest.ServiceVersion
    ApiContractVersion = $manifest.ApiContractVersion
    RequiredDatabaseSchema = $manifest.RequiredDatabaseSchema
    Capabilities = @($manifest.Capabilities)
    ManifestFingerprint = (Get-Sha256 $canonical).Substring(0, 16)
    BuildFingerprint = (Get-Sha256 ($canonical + "`n" + $sourceRevision)).Substring(0, 16)
    SourceRevision = $revision
    Dirty = $dirty
  }
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
  $serviceBuild = Get-ServiceBuildIdentity
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
    ServiceBuild = $serviceBuild
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
  Write-Info "serviceName $($config.ServiceBuild.Name)"
  Write-Info "serviceVersion $($config.ServiceBuild.Version)"
  Write-Info "apiContractVersion $($config.ServiceBuild.ApiContractVersion)"
  Write-Info "serviceBuildFingerprint $($config.ServiceBuild.BuildFingerprint)"
  Write-Info "requiredDatabaseSchema $($config.ServiceBuild.RequiredDatabaseSchema)"
  Write-Info "serviceCapabilities $($config.ServiceBuild.Capabilities -join ',')"
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

function Test-AgentServerCompatibility {
  param($Config, $RuntimeInfo)
  if (-not $RuntimeInfo) {
    return [PSCustomObject]@{ Kind = "build"; Reason = "runtime_info_unavailable"; MissingCapabilities = @(); ActualBuild = "none"; ActualSchema = "unknown"; ActualApiContract = "unknown" }
  }
  if ($RuntimeInfo.runtimeFingerprint -ne $Config.RuntimeFingerprint) {
    return [PSCustomObject]@{ Kind = "runtime"; Reason = "runtime_fingerprint_mismatch"; MissingCapabilities = @(); ActualBuild = "unknown"; ActualSchema = "unknown"; ActualApiContract = "unknown" }
  }
  if (-not $RuntimeInfo.service -or ($RuntimeInfo.service -is [string])) {
    return [PSCustomObject]@{ Kind = "build"; Reason = "service_identity_missing"; MissingCapabilities = @(); ActualBuild = "none"; ActualSchema = "unknown"; ActualApiContract = "unknown" }
  }
  $actualBuild = if ($RuntimeInfo.service.buildFingerprint) { [string]$RuntimeInfo.service.buildFingerprint } else { "none" }
  $actualApiContract = if ($RuntimeInfo.service.apiContractVersion) { [string]$RuntimeInfo.service.apiContractVersion } else { "unknown" }
  $actualSchema = if ($RuntimeInfo.database -and $null -ne $RuntimeInfo.database.schemaVersion) { [string]$RuntimeInfo.database.schemaVersion } else { "unknown" }
  if ($RuntimeInfo.service.name -ne $Config.ServiceBuild.Name) {
    return [PSCustomObject]@{ Kind = "build"; Reason = "service_name_mismatch"; MissingCapabilities = @(); ActualBuild = $actualBuild; ActualSchema = $actualSchema; ActualApiContract = $actualApiContract }
  }
  if ($actualApiContract -ne $Config.ServiceBuild.ApiContractVersion) {
    return [PSCustomObject]@{ Kind = "build"; Reason = "api_contract_mismatch"; MissingCapabilities = @(); ActualBuild = $actualBuild; ActualSchema = $actualSchema; ActualApiContract = $actualApiContract }
  }
  if ($actualBuild -ne $Config.ServiceBuild.BuildFingerprint) {
    return [PSCustomObject]@{ Kind = "build"; Reason = "service_build_mismatch"; MissingCapabilities = @(); ActualBuild = $actualBuild; ActualSchema = $actualSchema; ActualApiContract = $actualApiContract }
  }
  $actualCapabilities = @()
  if ($RuntimeInfo.service.capabilities) {
    $actualCapabilities = @($RuntimeInfo.service.capabilities | ForEach-Object { [string]$_ })
  }
  $actualCapabilitySet = @{}
  foreach ($capability in $actualCapabilities) {
    $actualCapabilitySet[$capability] = $true
  }
  $missingCapabilities = @()
  foreach ($capability in @($Config.ServiceBuild.Capabilities)) {
    if (-not $actualCapabilitySet.ContainsKey($capability)) {
      $missingCapabilities += $capability
    }
  }
  if ($missingCapabilities.Count -gt 0) {
    return [PSCustomObject]@{ Kind = "build"; Reason = "missing_capabilities"; MissingCapabilities = @($missingCapabilities); ActualBuild = $actualBuild; ActualSchema = $actualSchema; ActualApiContract = $actualApiContract }
  }
  $actualSchemaNumber = if ($RuntimeInfo.database -and $null -ne $RuntimeInfo.database.schemaVersion) { [int]$RuntimeInfo.database.schemaVersion } else { -1 }
  $actualCompatible = if ($RuntimeInfo.database -and $null -ne $RuntimeInfo.database.compatible) { [bool]$RuntimeInfo.database.compatible } else { $false }
  if ($actualSchemaNumber -lt $Config.ServiceBuild.RequiredDatabaseSchema -or -not $actualCompatible) {
    return [PSCustomObject]@{ Kind = "build"; Reason = "schema_incompatible"; MissingCapabilities = @(); ActualBuild = $actualBuild; ActualSchema = $actualSchema; ActualApiContract = $actualApiContract }
  }
  return [PSCustomObject]@{ Kind = "compatible"; Reason = "ok"; MissingCapabilities = @(); ActualBuild = $actualBuild; ActualSchema = $actualSchema; ActualApiContract = $actualApiContract }
}

function Write-BuildMismatch {
  param($Config, $Result, [int]$ListenerPid = 0)
  $missing = if ($Result.MissingCapabilities -and $Result.MissingCapabilities.Count -gt 0) { $Result.MissingCapabilities -join "," } else { "none" }
  Write-Output "AGENT_SERVER_BUILD_MISMATCH expectedBuild=$($Config.ServiceBuild.BuildFingerprint) actualBuild=$($Result.ActualBuild) expectedApi=$($Config.ServiceBuild.ApiContractVersion) actualApi=$($Result.ActualApiContract) expectedSchema=$($Config.ServiceBuild.RequiredDatabaseSchema) actualSchema=$($Result.ActualSchema) missingCapabilities=$missing reason=$($Result.Reason) pid=$ListenerPid"
}

function Start-LocalRuntime {
  $config = Resolve-RuntimeConfig $DataRoot $CoreRoot
  New-Item -ItemType Directory -Force -Path (Split-Path $config.AgentDbPath -Parent) | Out-Null
  $listener = Test-PortListener $config.AgentPort
  if ($listener) {
    $runtimeInfo = Get-RuntimeInfoFromPort $config.AgentPort
    $compatibility = Test-AgentServerCompatibility $config $runtimeInfo
    if ($compatibility.Kind -eq "runtime") {
      Write-Output "AGENT_SERVER_RUNTIME_MISMATCH expected=$($config.RuntimeFingerprint) actual=$($runtimeInfo.runtimeFingerprint) pid=$($listener.OwningProcess)"
      exit 1
    }
    # Dirty is a reuse policy, not a readiness condition for our newly started child.
    if ($runtimeInfo.service.name -eq $config.ServiceBuild.Name -and
        ($config.ServiceBuild.Dirty -or $runtimeInfo.service.dirty -eq $true)) {
      Fail-Code "AGENT_SERVER_DIRTY_REUSE_REFUSED" "Development source may differ; explicit restart required. sourceDirty=$($config.ServiceBuild.Dirty) instanceDirty=$($runtimeInfo.service.dirty) pid=$($listener.OwningProcess). Existing process was not stopped."
    }
    if ($compatibility.Kind -eq "compatible") {
      Write-Info "AGENT_SERVER_ALREADY_RUNNING_SAME_RUNTIME_AND_BUILD runtime=$($config.RuntimeFingerprint) build=$($config.ServiceBuild.BuildFingerprint)"
      return
    }
    Write-BuildMismatch $config $compatibility ([int]$listener.OwningProcess)
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
  Write-Info "AGENT_SERVER_STARTED pid=$($agent.Id) runtime=$($config.RuntimeFingerprint) build=$($config.ServiceBuild.BuildFingerprint) dirty=$($config.ServiceBuild.Dirty)"

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
    if ($runtimeInfo) {
      $compatibility = Test-AgentServerCompatibility $Config $runtimeInfo
      if ($compatibility.Kind -eq "compatible") {
        return
      }
      if ($compatibility.Kind -eq "runtime") {
        Write-Output "AGENT_SERVER_RUNTIME_MISMATCH expected=$($Config.RuntimeFingerprint) actual=$($runtimeInfo.runtimeFingerprint) pid=0"
        exit 1
      }
      Write-BuildMismatch $Config $compatibility 0
      exit 1
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

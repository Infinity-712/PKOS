$ErrorActionPreference = "Stop"

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Get-InfoValue {
  param(
    [Parameter(Mandatory = $true)]$Output,
    [Parameter(Mandatory = $true)][string]$Name
  )
  foreach ($line in @($Output)) {
    if ([string]$line -match ("\] " + [Regex]::Escape($Name) + "\s+(.+)$")) {
      return $Matches[1].Trim()
    }
  }
  throw "missing local-runtime show value: $Name"
}

function Wait-PortListener {
  param([Parameter(Mandatory = $true)][int]$Port)
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      return
    }
    Start-Sleep -Milliseconds 200
  }
  throw "fake runtime-info server did not listen on $Port"
}

function Start-FakeRuntimeInfoServer {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)]$Payload,
    [Parameter(Mandatory = $true)][string]$SmokeRoot
  )
  $payloadPath = Join-Path $SmokeRoot ("runtime-info-" + [System.Guid]::NewGuid().ToString("N") + ".json")
  $serverPath = Join-Path $SmokeRoot "fake-runtime-info-server.cjs"
  if (-not (Test-Path $serverPath)) {
    @'
const fs = require("fs");
const http = require("http");

const port = Number(process.argv[2]);
const payload = JSON.parse(fs.readFileSync(process.argv[3], "utf8").replace(/^\uFEFF/, ""));

const server = http.createServer((request, response) => {
  if (request.url === "/api/runtime-info") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
    return;
  }
  if (request.url === "/health") {
    const service = payload.service && payload.service.name ? payload.service.name : "pkos-agent-server";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      service,
      mode: "dry-run",
      runtimeFingerprint: payload.runtimeFingerprint,
      profileName: payload.profileName,
      serviceBuildFingerprint: payload.service ? payload.service.buildFingerprint : undefined,
      apiContractVersion: payload.service ? payload.service.apiContractVersion : undefined,
      databaseSchemaVersion: payload.database ? payload.database.schemaVersion : undefined,
      databaseRequiredSchemaVersion: payload.database ? payload.database.requiredSchemaVersion : undefined,
      databaseCompatible: payload.database ? payload.database.compatible : undefined
    }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }));
});

server.listen(port, "127.0.0.1");
'@ | Set-Content -Path $serverPath -Encoding UTF8
  }
  $Payload | ConvertTo-Json -Depth 30 | Set-Content -Path $payloadPath -Encoding UTF8
  $stdoutPath = Join-Path $SmokeRoot ("fake-runtime-info-" + $Port + ".out")
  $stderrPath = Join-Path $SmokeRoot ("fake-runtime-info-" + $Port + ".err")
  $process = Start-Process -FilePath "node" -ArgumentList @($serverPath, [string]$Port, $payloadPath) -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      return $process
    }
    if ($process.HasExited) {
      $stderr = if (Test-Path $stderrPath) { Get-Content -Raw $stderrPath } else { "" }
      throw "fake runtime-info server exited: $stderr"
    }
    Start-Sleep -Milliseconds 200
  }
  $stderr = if (Test-Path $stderrPath) { Get-Content -Raw $stderrPath } else { "" }
  throw "fake runtime-info server did not listen on $Port $stderr"
  return $process
}

function Stop-FakeRuntimeInfoServer {
  param($Process)
  if ($Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

function New-FakeRuntimeInfo {
  param(
    [Parameter(Mandatory = $true)][string]$RuntimeFingerprint,
    [Parameter(Mandatory = $true)][string]$ServiceBuildFingerprint,
    [Parameter(Mandatory = $true)][array]$Capabilities,
    [Parameter(Mandatory = $true)][int]$SchemaVersion,
    [Parameter(Mandatory = $true)][bool]$Compatible,
    [bool]$IncludeService = $true
  )
  $payload = [ordered]@{
    profileName = "local-main"
    runtimeFingerprint = $RuntimeFingerprint
    dataRoot = [ordered]@{ label = "FakeData"; fingerprint = "fake-data-root" }
    database = [ordered]@{ exists = $true; schemaVersion = $SchemaVersion; requiredSchemaVersion = 6; compatible = $Compatible }
    process = [ordered]@{ startedAt = "2026-07-14T00:00:00.000Z"; pid = 1111 }
    provider = [ordered]@{ profileId = "dry-run"; modelId = "dry-run"; reasoningPreset = "off"; keyConfigured = $false }
  }
  if ($IncludeService) {
    $payload.service = [ordered]@{
      name = "pkos-agent-server"
      version = "0.7-service-identity"
      apiContractVersion = "0.7"
      buildFingerprint = $ServiceBuildFingerprint
      sourceRevision = "fake-runtime"
      dirty = $false
      capabilities = @($Capabilities)
    }
  }
  return $payload
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot "local-runtime.ps1"
$smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pkos-local-runtime-smoke-" + [System.Guid]::NewGuid().ToString("N"))
$dataRoot = Join-Path $smokeRoot "Data Root With Spaces"
$altDataRoot = Join-Path $smokeRoot "Alt Data Root"
$runtimeLocal = Join-Path $repoRoot "runtime\local"
$runtimeLocalBackup = Join-Path $smokeRoot "runtime-local-backup"
$agentPort = 19000 + (Get-Random -Minimum 0 -Maximum 999)
$startedRuntime = $false

try {
  New-Item -ItemType Directory -Force -Path $smokeRoot | Out-Null
  if (Test-Path $runtimeLocal) {
    Move-Item -Path $runtimeLocal -Destination $runtimeLocalBackup
  }

  $oldDataRoot = $env:PKOS_DATA_ROOT
  $oldCoreRoot = $env:PKOS_CORE_ROOT
  Remove-Item Env:\PKOS_DATA_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:\PKOS_CORE_ROOT -ErrorAction SilentlyContinue

  $missing = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath validate 2>&1
  Assert-True (($LASTEXITCODE -ne 0) -and (($missing | Out-String).Contains("PKOS_DATA_ROOT_REQUIRED"))) "validate without data root did not fail with PKOS_DATA_ROOT_REQUIRED"

  & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath configure -DataRoot $dataRoot -ProfileName "local-main" | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) "configure failed"
  $profilePath = Join-Path $repoRoot "runtime\local\runtime-profile.json"
  Assert-True (Test-Path $profilePath) "runtime profile was not created"
  $profileText = Get-Content -Raw $profilePath
  Assert-True (-not $profileText.Contains("apiKey")) "profile contains apiKey"
  Assert-True (-not $profileText.Contains("secret")) "profile contains secret"

  $badProfile = $profileText | ConvertFrom-Json
  $badProfile | Add-Member -NotePropertyName "apiKey" -NotePropertyValue "SECRET_SHOULD_NOT_BE_ALLOWED"
  $badProfile | ConvertTo-Json -Depth 20 | Set-Content -Path $profilePath -Encoding UTF8
  $bad = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath validate 2>&1
  Assert-True (($LASTEXITCODE -ne 0) -and (($bad | Out-String).Contains("RUNTIME_PROFILE_FORBIDDEN_FIELD"))) "forbidden apiKey profile was not rejected"

  & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath configure -DataRoot $dataRoot -ProfileName "local-main" | Out-Null
  $show = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath show
  Assert-True (($show | Out-String).Contains("agent.sqlite")) "show did not include agent DB path"
  Assert-True (-not (($show | Out-String).Contains("SECRET_SHOULD_NOT_BE_ALLOWED"))) "show leaked secret"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath validate | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) "validate failed for good profile"

  New-Item -ItemType Directory -Force -Path $altDataRoot | Out-Null
  & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath validate -DataRoot $altDataRoot | Out-Null
  Assert-True ($LASTEXITCODE -eq 0) "argument data root with spaces did not validate"

  $profile = Get-Content -Raw $profilePath | ConvertFrom-Json
  $profile.ports.agentServer = $agentPort
  $profile.start.webDashboard = $false
  $profile.start.desktop = $false
  $profile | ConvertTo-Json -Depth 20 | Set-Content -Path $profilePath -Encoding UTF8

  $showWithService = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath show
  $runtimeFingerprint = Get-InfoValue $showWithService "runtimeFingerprint"
  $serviceBuildFingerprint = Get-InfoValue $showWithService "serviceBuildFingerprint"
  $manifest = Get-Content -Raw (Join-Path $repoRoot "apps\agent-server\service-capabilities.json") | ConvertFrom-Json
  $manifestCapabilities = @($manifest.capabilities)

  $fakeOldServer = Start-FakeRuntimeInfoServer -Port $agentPort -SmokeRoot $smokeRoot -Payload (New-FakeRuntimeInfo -RuntimeFingerprint $runtimeFingerprint -ServiceBuildFingerprint $serviceBuildFingerprint -Capabilities $manifestCapabilities -SchemaVersion 6 -Compatible $true -IncludeService $false)
  try {
    $oldBuildOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
    Assert-True (($LASTEXITCODE -ne 0) -and (($oldBuildOutput | Out-String).Contains("AGENT_SERVER_BUILD_MISMATCH"))) "old runtime-info without service identity was reused"
    Assert-True (-not $fakeOldServer.HasExited) "local runtime killed old fake server instead of refusing reuse"
  } finally {
    Stop-FakeRuntimeInfoServer $fakeOldServer
  }

  $missingReminderCapabilities = @($manifestCapabilities | Where-Object { $_ -ne "reminder.authority.write" })
  $fakeMissingCapability = Start-FakeRuntimeInfoServer -Port $agentPort -SmokeRoot $smokeRoot -Payload (New-FakeRuntimeInfo -RuntimeFingerprint $runtimeFingerprint -ServiceBuildFingerprint $serviceBuildFingerprint -Capabilities $missingReminderCapabilities -SchemaVersion 6 -Compatible $true)
  try {
    $missingCapabilityOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
    Assert-True (($LASTEXITCODE -ne 0) -and (($missingCapabilityOutput | Out-String).Contains("AGENT_SERVER_BUILD_MISMATCH")) -and (($missingCapabilityOutput | Out-String).Contains("reminder.authority.write"))) "missing service capability was not rejected"
    Assert-True (-not $fakeMissingCapability.HasExited) "local runtime killed fake server with missing capability"
  } finally {
    Stop-FakeRuntimeInfoServer $fakeMissingCapability
  }

  $fakeSchema5 = Start-FakeRuntimeInfoServer -Port $agentPort -SmokeRoot $smokeRoot -Payload (New-FakeRuntimeInfo -RuntimeFingerprint $runtimeFingerprint -ServiceBuildFingerprint $serviceBuildFingerprint -Capabilities $manifestCapabilities -SchemaVersion 5 -Compatible $false)
  try {
    $schema5Output = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
    Assert-True (($LASTEXITCODE -ne 0) -and (($schema5Output | Out-String).Contains("AGENT_SERVER_BUILD_MISMATCH")) -and (($schema5Output | Out-String).Contains("schema"))) "schema 5 runtime was not rejected"
  } finally {
    Stop-FakeRuntimeInfoServer $fakeSchema5
  }

  $reversedCapabilities = @($manifestCapabilities)
  [array]::Reverse($reversedCapabilities)
  $fakeReorderedCapabilities = Start-FakeRuntimeInfoServer -Port $agentPort -SmokeRoot $smokeRoot -Payload (New-FakeRuntimeInfo -RuntimeFingerprint $runtimeFingerprint -ServiceBuildFingerprint $serviceBuildFingerprint -Capabilities $reversedCapabilities -SchemaVersion 6 -Compatible $true)
  try {
    $capabilityOrderOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
    Assert-True (($LASTEXITCODE -eq 0) -and (($capabilityOrderOutput | Out-String).Contains("AGENT_SERVER_ALREADY_RUNNING_SAME_RUNTIME_AND_BUILD"))) "capability order changed reuse decision"
  } finally {
    Stop-FakeRuntimeInfoServer $fakeReorderedCapabilities
  }

  $startOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
  Assert-True (($startOutput | Out-String).Contains("AGENT_SERVER_STARTED")) "start did not launch agent server"
  $startedRuntime = $true
  $reuseOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
  Assert-True (($reuseOutput | Out-String).Contains("AGENT_SERVER_ALREADY_RUNNING_SAME_RUNTIME_AND_BUILD")) "same runtime and build did not reuse existing server"

  $profile.dataRoot = $altDataRoot
  $profile | ConvertTo-Json -Depth 20 | Set-Content -Path $profilePath -Encoding UTF8
  $mismatchOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
  Assert-True (($LASTEXITCODE -ne 0) -and (($mismatchOutput | Out-String).Contains("AGENT_SERVER_RUNTIME_MISMATCH"))) "different runtime did not report mismatch"
  $profile.dataRoot = $dataRoot
  $profile | ConvertTo-Json -Depth 20 | Set-Content -Path $profilePath -Encoding UTF8

  $processPath = Join-Path $repoRoot "runtime\local\processes.json"
  $existingRecords = if (Test-Path $processPath) { Get-Content -Raw $processPath | ConvertFrom-Json } else { @() }
  $records = @($existingRecords) + @([PSCustomObject]@{ pid = 999999; role = "agent-server"; startedAt = "2000-01-01T00:00:00.000Z"; runtimeFingerprint = "mismatch" })
  $records | ConvertTo-Json -Depth 20 | Set-Content -Path $processPath -Encoding UTF8
  $stopOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath stop 2>&1
  Assert-True (($stopOutput | Out-String).Contains("PROCESS_STOPPED")) "stop did not stop script-started process"
  Assert-True (($stopOutput | Out-String).Contains("PROCESS_IDENTITY_MISMATCH") -or ($stopOutput | Out-String).Contains("PROCESS_NOT_RUNNING")) "stop did not safely handle PID mismatch/not-running"
  $startedRuntime = $false
  Assert-True (-not ((Get-Content -Raw $processPath).Contains("SECRET"))) "processes.json contains secret"

  Write-Output "LOCAL_RUNTIME_SMOKE_OK"
} finally {
  if ($null -eq $oldDataRoot) {
    Remove-Item Env:\PKOS_DATA_ROOT -ErrorAction SilentlyContinue
  } else {
    $env:PKOS_DATA_ROOT = $oldDataRoot
  }
  if ($null -eq $oldCoreRoot) {
    Remove-Item Env:\PKOS_CORE_ROOT -ErrorAction SilentlyContinue
  } else {
    $env:PKOS_CORE_ROOT = $oldCoreRoot
  }
  if ($startedRuntime) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath stop -DataRoot $dataRoot 2>&1 | Out-Null
  }
  Remove-Item -Recurse -Force $runtimeLocal -ErrorAction SilentlyContinue
  if (Test-Path $runtimeLocalBackup) {
    New-Item -ItemType Directory -Force -Path (Split-Path $runtimeLocal -Parent) | Out-Null
    Move-Item -Path $runtimeLocalBackup -Destination $runtimeLocal
  }
  Remove-Item -Recurse -Force $smokeRoot -ErrorAction SilentlyContinue
}

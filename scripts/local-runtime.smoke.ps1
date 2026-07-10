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

  $startOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
  Assert-True (($startOutput | Out-String).Contains("AGENT_SERVER_STARTED")) "start did not launch agent server"
  $startedRuntime = $true
  $reuseOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath start 2>&1
  Assert-True (($reuseOutput | Out-String).Contains("AGENT_SERVER_ALREADY_RUNNING_SAME_RUNTIME")) "same runtime did not reuse existing server"

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

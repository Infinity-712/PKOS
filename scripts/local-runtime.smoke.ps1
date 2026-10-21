param([string]$Case)

$ErrorActionPreference = "Stop"

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

if (-not $Case) {
  $cases = @(
    @{ Name = "dirty-source-reuse"; Code = 1; Marker = "AGENT_SERVER_DIRTY_REUSE_REFUSED" },
    @{ Name = "dirty-instance-reuse"; Code = 1; Marker = "AGENT_SERVER_DIRTY_REUSE_REFUSED" },
    @{ Name = "both-dirty-reuse"; Code = 1; Marker = "AGENT_SERVER_DIRTY_REUSE_REFUSED" },
    @{ Name = "dirty-reuse-build"; Code = 1; Marker = "AGENT_SERVER_DIRTY_REUSE_REFUSED" },
    @{ Name = "clean-reuse"; Code = 0; Marker = "CASE_OK" },
    @{ Name = "dirty-first-start"; Code = 0; Marker = "CASE_OK" },
    @{ Name = "dirty-ready-runtime"; Code = 1; Marker = "AGENT_SERVER_RUNTIME_MISMATCH" },
    @{ Name = "dirty-ready-service"; Code = 1; Marker = "service_name_mismatch" },
    @{ Name = "dirty-ready-api"; Code = 1; Marker = "api_contract_mismatch" },
    @{ Name = "dirty-ready-build"; Code = 1; Marker = "service_build_mismatch" },
    @{ Name = "dirty-ready-capability"; Code = 1; Marker = "missing_capabilities" },
    @{ Name = "dirty-ready-schema"; Code = 1; Marker = "schema_incompatible" },
    @{ Name = "unknown-runtime"; Code = 1; Marker = "AGENT_SERVER_RUNTIME_MISMATCH" },
    @{ Name = "unknown-identity"; Code = 1; Marker = "service_identity_missing" },
    @{ Name = "unknown-service"; Code = 1; Marker = "service_name_mismatch" },
    @{ Name = "unknown-unavailable"; Code = 1; Marker = "runtime_info_unavailable" },
    @{ Name = "unknown-capability"; Code = 1; Marker = "missing_capabilities" },
    @{ Name = "unknown-schema"; Code = 1; Marker = "schema_incompatible" },
    @{ Name = "stop-ownership"; Code = 0; Marker = "CASE_OK" },
    @{ Name = "profile-validation"; Code = 0; Marker = "CASE_OK" }
  )
  $failures = @()
  foreach ($test in $cases) {
    # Synchronous, owned PowerShell children only; no Agent Server/model is launched.
    $ErrorActionPreference = "Continue"
    $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -Case $test.Name 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $result = $output | Out-String
    $passed = $code -eq $test.Code -and $result.Contains($test.Marker) -and
      $result.Contains("FIXTURE_CLEANUP_OK") -and -not $result.Contains("UNEXPECTED_")
    if ($test.Marker -eq "AGENT_SERVER_DIRTY_REUSE_REFUSED") {
      $passed = $passed -and $result.Contains("explicit restart required") -and
        -not $result.Contains("AGENT_SERVER_ALREADY_RUNNING")
    }
    if ($test.Name -like "*-capability") {
      $passed = $passed -and $result.Contains("missingCapabilities=reminder.authority.write ")
    }
    Write-Output "$($test.Name): exit=$code expected=$($test.Code) passed=$passed"
    if (-not $passed) { $failures += "$($test.Name): $result" }
  }
  if ($failures.Count) { throw ($failures -join "`n") }
  Write-Output "LOCAL_RUNTIME_SMOKE_OK isolated=temp-profile,temp-data; network/process-launch=synthetic"
  exit 0
}

$smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pkos-local-runtime-smoke-" + [guid]::NewGuid().ToString("N"))
$sourceRoot = Split-Path -Parent $PSScriptRoot
try {
  # Load production functions, not the dispatcher or real runtime/profile paths.
  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot "local-runtime.ps1"), [ref]$tokens, [ref]$parseErrors)
  Assert-True ($parseErrors.Count -eq 0) "local-runtime.ps1 parse failed"
  foreach ($statement in $ast.EndBlock.Statements) {
    if ($statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
      . ([scriptblock]::Create($statement.Extent.Text))
    }
  }
  $RepoRoot = Join-Path $smokeRoot "Core Root"
  $DataRoot = Join-Path $smokeRoot "Data Root"
  $CoreRoot = $RepoRoot
  $ProfileName = "synthetic-smoke"
  $RuntimeLocalDir = Join-Path $RepoRoot "runtime/local"
  $ProfilePath = Join-Path $RuntimeLocalDir "runtime-profile.json"
  $ProcessesPath = Join-Path $RuntimeLocalDir "processes.json"
  # Use the production whitelist, not a separately maintained test copy.
  $fields = $ast.EndBlock.Statements | Where-Object {
    $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -eq '$ForbiddenProfileFields'
  }
  . ([scriptblock]::Create($fields.Extent.Text))
  foreach ($directory in @($DataRoot, $RuntimeLocalDir, (Join-Path $RepoRoot "apps/agent-server"), (Join-Path $RepoRoot "tools"), (Join-Path $RepoRoot "docs"))) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  Copy-Item -LiteralPath (Join-Path $sourceRoot "apps/agent-server/service-capabilities.json") -Destination (Join-Path $RepoRoot "apps/agent-server/service-capabilities.json")
  $env:PKOS_BUILD_REVISION = "synthetic-revision"
  $env:PKOS_BUILD_DIRTY = if ($Case -like "dirty-*" -or $Case -eq "both-dirty-reuse") { "true" } else { "false" }
  if ($Case -eq "dirty-instance-reuse") { $env:PKOS_BUILD_DIRTY = "false" }
  $env:PKOS_DATA_ROOT = $DataRoot
  $env:PKOS_CORE_ROOT = $CoreRoot
  $secretSentinel = "SYNTHETIC_SECRET_MUST_NOT_BE_EMITTED"
  $env:PKOS_SMOKE_SECRET_SENTINEL = $secretSentinel
  Configure-Profile | Out-Null
  $profile = Get-Content -Raw -LiteralPath $ProfilePath | ConvertFrom-Json
  $profile.start.webDashboard = $false
  $profile.start.desktop = $false
  # This is synthetic, never a real socket; all network boundaries below are fixtures.
  $profile.ports.agentServer = 49152
  $profile | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ProfilePath -Encoding UTF8
  $config = Resolve-RuntimeConfig $DataRoot $CoreRoot
  $script:info = [pscustomobject]@{
    runtimeFingerprint = $config.RuntimeFingerprint
    service = [pscustomobject]@{
      name = $config.ServiceBuild.Name
      apiContractVersion = $config.ServiceBuild.ApiContractVersion
      buildFingerprint = $config.ServiceBuild.BuildFingerprint
      dirty = ($Case -eq "dirty-instance-reuse" -or $Case -eq "both-dirty-reuse" -or $Case -like "dirty-ready-*" -or $Case -eq "dirty-first-start")
      capabilities = @($config.ServiceBuild.Capabilities | Sort-Object -Descending)
    }
    database = [pscustomobject]@{ schemaVersion = $config.ServiceBuild.RequiredDatabaseSchema; compatible = $true }
  }
  switch -Wildcard ($Case) {
    "*-runtime" { $script:info.runtimeFingerprint = "other-runtime" }
    "*-identity" { $script:info.service = $null }
    "*-unavailable" { $script:info = $null }
    "*-service" { $script:info.service.name = "other-service" }
    "*-api" { $script:info.service.apiContractVersion = "other-api" }
    "*-build" { $script:info.service.buildFingerprint = "other-build" }
    "*-capability" {
      Assert-True ($config.ServiceBuild.Capabilities -contains "reminder.authority.write") "required capability fixture missing from manifest"
      $script:info.service.capabilities = @($script:info.service.capabilities | Where-Object { $_ -ne "reminder.authority.write" })
    }
    "*-schema" { $script:info.database.schemaVersion = 0; $script:info.database.compatible = $false }
  }
  $script:firstStart = $Case -eq "dirty-first-start" -or $Case -like "dirty-ready-*"
  $script:launches = 0
  $script:reads = 0
  function Test-PortListener {
    param([int]$Port)
    Assert-True ($Port -eq 49152) "unexpected fixture port"
    if (-not $script:firstStart) { return [pscustomobject]@{ OwningProcess = 424242 } }
  }
  function Get-RuntimeInfoFromPort {
    param([int]$Port)
    Assert-True ($Port -eq 49152) "unexpected fixture port"
    $script:reads++
    return $script:info
  }
  function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, [switch]$PassThru)
    if (-not $script:firstStart) { throw "UNEXPECTED_LAUNCH" }
    Assert-True ($env:PKOS_DATA_ROOT -eq $DataRoot) "launch data root escaped fixture"
    Assert-True ($env:PKOS_AGENT_DB_PATH -eq $config.AgentDbPath) "launch DB path escaped fixture"
    Assert-True ($WorkingDirectory -eq (Join-Path $CoreRoot "apps/agent-server")) "launch core escaped fixture"
    $script:launches++
    return [pscustomobject]@{ Id = 424243; StartTime = [datetime]::UtcNow }
  }
  function Stop-Process { throw "UNEXPECTED_STOP" }
  function Stop-ProcessTree { throw "UNEXPECTED_STOP_TREE" }

  if ($Case -eq "stop-ownership") {
    $now = [datetime]::UtcNow
    $script:stopped = @()
    function Get-Process {
      param($Id, $ErrorAction)
      if ($Id -ne 424245) { return [pscustomobject]@{ StartTime = $now } }
    }
    function Stop-ProcessTree {
      param([int]$ProcessId)
      if ($ProcessId -ne 424246) { throw "UNEXPECTED_STOP_TREE" }
      $script:stopped += $ProcessId
    }
    Write-ProcessRecords @(
      [pscustomobject]@{ pid = 424242; role = "agent-server"; startedAt = $now.ToString("o"); runtimeFingerprint = "other" },
      [pscustomobject]@{ pid = 424244; role = "agent-server"; startedAt = $now.AddMinutes(-5).ToString("o"); runtimeFingerprint = $config.RuntimeFingerprint },
      [pscustomobject]@{ pid = 424245; role = "agent-server"; startedAt = $now.ToString("o"); runtimeFingerprint = $config.RuntimeFingerprint },
      [pscustomobject]@{ pid = 424246; role = "agent-server"; startedAt = $now.ToString("o"); runtimeFingerprint = $config.RuntimeFingerprint }
    )
    $output = Stop-LocalRuntime | Out-String
    Assert-True ($script:stopped.Count -eq 1 -and $script:stopped[0] -eq 424246) "owned stop missing"
    Assert-True (@(Read-ProcessRecords).Count -eq 2) "unknown process records were not retained"
    Assert-True (-not (Get-Content -Raw -LiteralPath $ProcessesPath).Contains($secretSentinel)) "stop process ledger leaked synthetic secret"
  } elseif ($Case -eq "profile-validation") {
    $show = Show-Runtime | Out-String
    Assert-True ($show.Contains($config.AgentDbPath)) "show missing isolated DB path"
    Assert-True (-not $show.Contains($secretSentinel)) "show leaked synthetic secret"
    $profile | Add-Member -NotePropertyName apiKey -NotePropertyValue $secretSentinel
    function Fail-Code { param($Code, $Message); throw $Code }
    $profile | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ProfilePath -Encoding UTF8
    $rejected = $false
    try { Resolve-RuntimeConfig $DataRoot $CoreRoot | Out-Null } catch {
      $rejected = $_.Exception.Message -eq "RUNTIME_PROFILE_FORBIDDEN_FIELD"
    }
    Assert-True $rejected "forbidden profile field accepted"
    $profile.PSObject.Properties.Remove("apiKey")
    $profile | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ProfilePath -Encoding UTF8
    $show = Show-Runtime | Out-String
    Assert-True (-not $show.Contains($secretSentinel)) "show leaked rejected profile secret"
    $alternate = Join-Path $smokeRoot "Alternate Data Root"
    New-Item -ItemType Directory -Path $alternate | Out-Null
    $alternateConfig = Resolve-RuntimeConfig $alternate $CoreRoot
    Assert-True ($alternateConfig.DataRoot -eq $alternate -and $alternateConfig.DataSource -eq "argument") "argument data root lost precedence"
    Remove-Item -LiteralPath $ProfilePath
    Remove-Item Env:\PKOS_DATA_ROOT
    $rejected = $false
    try { Resolve-RuntimeConfig "" $CoreRoot | Out-Null } catch {
      $rejected = $_.Exception.Message -eq "PKOS_DATA_ROOT_REQUIRED"
    }
    Assert-True $rejected "missing profile/data root accepted"
  } else {
    Start-LocalRuntime | Tee-Object -Variable startLines
    $output = $startLines | Out-String
    if ($Case -eq "clean-reuse") {
      Assert-True ($output.Contains("AGENT_SERVER_ALREADY_RUNNING_SAME_RUNTIME_AND_BUILD")) "clean reuse rejected"
      Assert-True ($script:launches -eq 0) "reuse launched child"
    } elseif ($Case -eq "dirty-first-start") {
      Assert-True ($output.Contains("AGENT_SERVER_STARTED")) "dirty first start rejected"
      Assert-True ($output.Contains("dirty=True")) "dirty first start did not display source state"
      Assert-True ($script:launches -eq 1 -and $script:reads -gt 0) "first start skipped readiness"
      Assert-True (@(Read-ProcessRecords).Count -eq 1) "first start did not record child"
      Assert-True (-not (Get-Content -Raw -LiteralPath $ProcessesPath).Contains($secretSentinel)) "startup process ledger leaked synthetic secret"
    } else {
      throw "UNEXPECTED_REUSE_OR_READY_SUCCESS: $Case $output"
    }
  }
  Write-Output "CASE_OK $Case"
} finally {
  # Only the GUID directory created by this test child can be recursively deleted.
  $resolved = [System.IO.Path]::GetFullPath($smokeRoot)
  $temp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($temp, [System.StringComparison]::OrdinalIgnoreCase) -or
      (Split-Path -Leaf $resolved) -notmatch '^pkos-local-runtime-smoke-[0-9a-f]{32}$') {
    throw "unsafe smoke cleanup path"
  }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
  Assert-True (-not (Test-Path -LiteralPath $resolved)) "fixture cleanup failed"
  Write-Output "FIXTURE_CLEANUP_OK"
}

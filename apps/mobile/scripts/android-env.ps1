[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$JavaHome,
    [string]$SdkRoot,
    [string]$GradleUserHome,
    [string]$TempRoot
)

$ErrorActionPreference = 'Stop'
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot '../.local/android-toolchain.json' }
if (Test-Path -LiteralPath $ConfigPath) {
    $LocalConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $JavaHome) { $JavaHome = $LocalConfig.javaHome }
    if (-not $SdkRoot) { $SdkRoot = $LocalConfig.sdkRoot }
    if (-not $GradleUserHome) { $GradleUserHome = $LocalConfig.gradleUserHome }
    if (-not $TempRoot) { $TempRoot = $LocalConfig.tempRoot }
}
foreach ($Value in @($JavaHome, $SdkRoot, $GradleUserHome, $TempRoot)) {
    if (-not $Value -or -not [IO.Path]::IsPathRooted($Value)) {
        throw 'Provide absolute javaHome/sdkRoot/gradleUserHome/tempRoot via parameters or ignored .local/android-toolchain.json.'
    }
}
$JavaHome = [IO.Path]::GetFullPath($JavaHome).TrimEnd('\')
$SdkRoot = [IO.Path]::GetFullPath($SdkRoot).TrimEnd('\')
$GradleUserHome = [IO.Path]::GetFullPath($GradleUserHome)
$TempRoot = [IO.Path]::GetFullPath($TempRoot)
foreach ($Binary in @('java.exe', 'javac.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $JavaHome "bin/$Binary"))) { throw "Missing JDK binary: $Binary in $JavaHome" }
}
if (-not (Test-Path -LiteralPath $SdkRoot -PathType Container)) { throw "SDK directory does not exist: $SdkRoot" }

$AndroidRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../android'))
if (Test-Path -LiteralPath (Join-Path $AndroidRoot 'gradle/gradle-daemon-jvm.properties')) {
    throw 'gradle-daemon-jvm.properties overrides JAVA_HOME; review it explicitly before using this helper.'
}
$LocalProperties = Join-Path $AndroidRoot 'local.properties'
foreach ($Properties in @((Join-Path $AndroidRoot 'gradle.properties'), (Join-Path $GradleUserHome 'gradle.properties'), $LocalProperties)) {
    if (-not (Test-Path -LiteralPath $Properties)) { continue }
    foreach ($Line in (Get-Content -LiteralPath $Properties -Encoding UTF8)) {
        if ($Line -match '^\s*[#!]') { continue }
        # Require simple keys and single-line properties before checking overrides.
        if ($Line -match '^\s*[^\s=:]*\\' -or $Line -match '(?<!\\)(?:\\\\)*\\$') {
            throw "Escaped keys or continued lines in $Properties require explicit review before building."
        }
        if ($Line -match '^\s*(org\.gradle\.java\.home|org\.gradle\.java\.installations\.[^\s=:]+)(?:\s*[=:]|\s+)') {
            throw "Explicit JVM/toolchain override in $Properties ($($Matches[1])); review before building."
        }
    }
}
if (Test-Path -LiteralPath $LocalProperties) {
    foreach ($Line in (Get-Content -LiteralPath $LocalProperties -Encoding UTF8)) {
        if ($Line -match '^\s*sdk\.dir(?:\s*[=:]\s*|\s+)(.+)$') {
            $ExistingSdk = $Matches[1].Replace('\:', ':').Replace('\\', '\')
            if ([IO.Path]::GetFullPath($ExistingSdk).TrimEnd('\') -ne $SdkRoot) {
                throw 'android/local.properties sdk.dir conflicts with selected SDK; preserve other properties and correct it explicitly.'
            }
        }
    }
}
foreach ($Name in @('JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'GRADLE_OPTS')) {
    if ([Environment]::GetEnvironmentVariable($Name, 'Process')) { throw "$Name is set; review it explicitly in this terminal before building (value not printed)." }
}
if ($env:ANDROID_SDK_ROOT -and [IO.Path]::GetFullPath($env:ANDROID_SDK_ROOT).TrimEnd('\') -ne $SdkRoot) {
    Write-Warning 'ANDROID_SDK_ROOT conflicts with selected ANDROID_HOME; aligning it in this process only.'
}
New-Item -ItemType Directory -Path $GradleUserHome, $TempRoot -Force | Out-Null
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:GRADLE_USER_HOME = $GradleUserHome
$env:TEMP = $TempRoot
$env:TMP = $TempRoot
$env:PATH = "$(Join-Path $JavaHome 'bin');$(Join-Path $SdkRoot 'platform-tools');$env:PATH"
Write-Verbose "JAVA_HOME=$JavaHome; ANDROID_HOME=$SdkRoot; GRADLE_USER_HOME=$GradleUserHome"

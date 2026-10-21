$ErrorActionPreference = 'Stop'
$AndroidRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../android'))
$Intermediates = Join-Path $AndroidRoot 'app/build/intermediates'
$Apk = Join-Path $AndroidRoot 'app/build/outputs/apk/debug/app-debug.apk'
if (-not (Test-Path -LiteralPath $Apk)) { throw 'APK_CONFIG_VERIFICATION_BLOCKED: no built APK; source/sync checks are not merged Manifest verification.' }
$AndroidNs = 'http://schemas.android.com/apk/res/android'
foreach ($Variant in @('debug', 'release')) {
    $Candidates = @(Get-ChildItem -LiteralPath $Intermediates -Recurse -Filter AndroidManifest.xml | Where-Object { $_.FullName -match "[\\/]merged_manifests?[\\/]$Variant[\\/]" })
    if ($Candidates.Count -eq 0) { throw "No merged $Variant Manifest; run processReleaseMainManifest and assembleDebug." }
    foreach ($File in $Candidates) {
        [xml]$Manifest = Get-Content -LiteralPath $File.FullName -Raw -Encoding UTF8
        $Application = $Manifest.manifest.application
        if ($Application.GetAttribute('usesCleartextTraffic', $AndroidNs) -eq 'true') { throw 'Global cleartext is forbidden.' }
        if ($Application.GetAttribute('networkSecurityConfig', $AndroidNs) -ne '@xml/network_security_config') { throw 'Missing scoped network security policy.' }
        if ($Variant -eq 'debug' -and $Application.GetAttribute('debuggable', $AndroidNs) -ne 'true') { throw 'Expected debug application.' }
        if ($Variant -eq 'release' -and $Application.GetAttribute('debuggable', $AndroidNs) -eq 'true') { throw 'Release inherited debug configuration.' }
    }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Zip = [IO.Compression.ZipFile]::OpenRead($Apk)
try {
    $Entry = $Zip.GetEntry('assets/capacitor.config.json')
    if (-not $Entry) { throw 'APK has no Capacitor configuration.' }
    $Reader = New-Object IO.StreamReader($Entry.Open())
    try { $Config = $Reader.ReadToEnd() | ConvertFrom-Json } finally { $Reader.Dispose() }
    if ($Config.server.androidScheme -ne 'http' -or $Config.server.hostname -ne 'localhost') { throw 'Unexpected APK page origin.' }
    if ($Config.server.url -or $Config.server.cleartext -or $Config.android.allowMixedContent -or $Config.plugins.CapacitorHttp.enabled) { throw 'Unsafe APK network configuration.' }
    if (-not $Zip.GetEntry('assets/public/index.html')) { throw 'APK UI assets are not bundled.' }
} finally { $Zip.Dispose() }
Write-Output 'ANDROID_MERGED_MANIFEST_AND_DEBUG_APK_CONFIG_OK'

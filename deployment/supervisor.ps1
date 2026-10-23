$ErrorActionPreference = 'Stop'
$env:YINGKEY_HOST = '127.0.0.1'
$env:YINGKEY_PORT = '17891'
$settingsPath = Join-Path $PSScriptRoot 'service-settings.json'
if (Test-Path -LiteralPath $settingsPath) {
    $serviceSettings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
    if ($serviceSettings.publicUrl) { $env:YINGKEY_PUBLIC_URL = [string]$serviceSettings.publicUrl }
    $env:YINGKEY_TRUST_PROXY = if ($serviceSettings.trustProxy -eq $true) { '1' } else { '0' }
}
Set-Location -LiteralPath $PSScriptRoot
while ($true) {
    try { & "$PSScriptRoot\node.exe" "$PSScriptRoot\server\server.mjs" >> "$PSScriptRoot\service.log" 2>&1 } catch { $_ | Out-File -Append "$PSScriptRoot\service.log" }
    Start-Sleep -Seconds 5
}

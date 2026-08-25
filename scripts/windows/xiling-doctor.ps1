[CmdletBinding()]
param([switch]$Json)

$ErrorActionPreference = "Stop"
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [bool]$Ok, [string]$Detail) {
    $checks.Add([pscustomobject]@{ name = $Name; ok = $Ok; detail = $Detail })
}

$version = [Environment]::OSVersion.Version
Add-Check "windows-11" ($version.Build -ge 22000) ([Environment]::OSVersion.VersionString)

$memory = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
Add-Check "memory" ($memory -ge 8GB) ("{0:N1} GB installed" -f ($memory / 1GB))
try {
    $virtualization = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
    Add-Check "virtualization" ([bool]$virtualization) $(if ($virtualization) { "enabled in firmware" } else { "enable CPU virtualization in firmware" })
} catch { Add-Check "virtualization" $false "could not inspect firmware virtualization" }

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
Add-Check "wsl" ($null -ne $wsl) $(if ($wsl) { "wsl.exe available" } else { "Install WSL2; no changes were made" })
if ($wsl) {
    $null = (& wsl.exe --status 2>&1 | Out-String)
    Add-Check "wsl-status" ($LASTEXITCODE -eq 0) $(if ($LASTEXITCODE -eq 0) { "WSL status available" } else { "WSL2 is not ready; no changes were made" })
}

$docker = Get-Command docker.exe -ErrorAction SilentlyContinue
Add-Check "docker" ($null -ne $docker) $(if ($docker) { "docker.exe available" } else { "Install Docker Desktop WSL2 backend; no changes were made" })
if ($docker) {
    $dockerOs = (& docker.exe info --format '{{.OSType}}' 2>$null | Out-String).Trim()
    Add-Check "docker-linux" ($dockerOs -eq "linux") $(if ($dockerOs -eq "linux") { "Linux container backend ready" } else { "Start Docker Desktop with the WSL2 Linux backend" })
}

$portFree = $null -eq (Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue)
Add-Check "port-4317" $portFree $(if ($portFree) { "available" } else { "occupied" })

$drive = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(":"))
Add-Check "disk" ($drive.Free -ge 20GB) ("{0:N1} GB free" -f ($drive.Free / 1GB))

$proxyConfigured = [bool]($env:HTTPS_PROXY -or $env:HTTP_PROXY)
$caConfigured = [bool]($env:REQUESTS_CA_BUNDLE -or $env:SSL_CERT_FILE)
Add-Check "network-config" $true ("proxy={0}; custom-ca={1}; values are not logged" -f $proxyConfigured, $caConfigured)

$result = [pscustomobject]@{ ok = -not ($checks.ok -contains $false); checks = $checks }
if ($Json) { $result | ConvertTo-Json -Depth 4 } else { $checks | Format-Table -AutoSize }
if (-not $result.ok) { exit 2 }

[CmdletBinding(SupportsShouldProcess)]
param([string]$Distribution = "XiLingOS", [switch]$NoBrowser)

$ErrorActionPreference = "Stop"
& "$PSScriptRoot\xiling-doctor.ps1"
if ($LASTEXITCODE -ne 0) { throw "Doctor checks failed" }

if ($PSCmdlet.ShouldProcess($Distribution, "Start Xi Ling OS services in WSL2")) {
    wsl.exe --distribution $Distribution --exec sh -lc "cd /opt/xiling-os && ./scripts/xiling-start.sh"
    if ($LASTEXITCODE -ne 0) { throw "Xi Ling OS WSL startup failed" }
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:4317/health" -TimeoutSec 2
            if ($health.status -eq "ok") { $ready = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $ready) { throw "Xi Ling OS did not become healthy within 30 seconds; run xiling-doctor.ps1 -Json" }
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:4317/" }
}

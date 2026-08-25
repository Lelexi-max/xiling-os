[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "High")]
param([string]$Distribution = "XiLingOS")

$ErrorActionPreference = "Stop"
& "$PSScriptRoot\xiling-doctor.ps1"
Write-Host "Gate 2 installer prototype: prerequisites inspected; no system feature was changed."
if ($PSCmdlet.ShouldProcess($Distribution, "Create managed Xi Ling OS WSL2 distribution")) {
    Write-Host "The distribution import is intentionally deferred until a signed rootfs exists."
}

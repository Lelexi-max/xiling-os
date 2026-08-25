[CmdletBinding(SupportsShouldProcess, ConfirmImpact = "High")]
param([string]$Distribution = "XiLingOS", [switch]$ForceRecovery)

$ErrorActionPreference = "Stop"
wsl.exe --distribution $Distribution --exec sh -lc "curl --fail --silent --request POST http://127.0.0.1:4317/api/system/stop || true"
if ($ForceRecovery -and $PSCmdlet.ShouldProcess($Distribution, "Force terminate the managed WSL distribution after graceful stop failed")) {
    wsl.exe --terminate $Distribution
}

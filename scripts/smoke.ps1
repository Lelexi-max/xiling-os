$ErrorActionPreference = "Stop"

pnpm smoke
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

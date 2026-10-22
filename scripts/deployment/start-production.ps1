param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $root 'backend\.env'

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing backend/.env. Configure the production environment before startup."
}

Push-Location $root
try {
  & npm.cmd start
  if ($LASTEXITCODE -ne 0) {
    throw "AutoFlow production startup failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

param(
  [string]$Version = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $root 'artifacts'))
$bundleName = "AutoFlow-Deployment-$Version"
$staging = [IO.Path]::GetFullPath((Join-Path $artifactRoot $bundleName))
$archive = [IO.Path]::GetFullPath((Join-Path $artifactRoot "$bundleName.zip"))

if (-not $staging.StartsWith("$artifactRoot$([IO.Path]::DirectorySeparatorChar)")) {
  throw "Invalid staging path: $staging"
}

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

Push-Location $root
try {
  if (-not $SkipBuild) {
    Invoke-Checked 'npm.cmd' @('run', 'build')
  }

  $required = @(
    'backend\dist\src\main.js',
    'backend\dist\public\index.html',
    'backend\dist\src\database\migrations',
    'package.json',
    'package-lock.json',
    'backend\package.json',
    'frontend\package.json'
  )
  foreach ($relativePath in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relativePath))) {
      throw "Required deployment input is missing: $relativePath"
    }
  }

  New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
  if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
  }

  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $staging 'backend') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $staging 'frontend') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $staging 'scripts') -Force | Out-Null

  Copy-Item -LiteralPath (Join-Path $root 'package.json') -Destination $staging
  Copy-Item -LiteralPath (Join-Path $root 'package-lock.json') -Destination $staging
  Copy-Item -LiteralPath (Join-Path $root 'backend\package.json') -Destination (Join-Path $staging 'backend')
  Copy-Item -LiteralPath (Join-Path $root 'backend\dist') -Destination (Join-Path $staging 'backend') -Recurse
  Copy-Item -LiteralPath (Join-Path $root 'frontend\package.json') -Destination (Join-Path $staging 'frontend')
  Copy-Item -LiteralPath (Join-Path $root 'scripts\deployment') -Destination (Join-Path $staging 'scripts') -Recurse
  Copy-Item -LiteralPath (Join-Path $root 'deployment') -Destination $staging -Recurse
  Copy-Item -LiteralPath (Join-Path $root 'docs\AUTOFLOW_NEW_ENVIRONMENT_DEPLOYMENT_GUIDE_ZH-CN.md') `
    -Destination (Join-Path $staging 'README-DEPLOY-ZH-CN.md')

  Copy-Item -LiteralPath (Join-Path $root 'deployment\.env.production.example') `
    -Destination (Join-Path $staging 'backend\.env.example')

  New-Item -ItemType Directory -Path (Join-Path $staging 'backend\uploads') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $staging 'backend\uploads\README.md') `
    -Value 'Persistent workflow seed uploads are stored in this directory. Back it up separately.' `
    -Encoding utf8

  Compress-Archive -LiteralPath $staging -DestinationPath $archive -CompressionLevel Optimal
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$archive.sha256" -Value "$hash  $bundleName.zip" -Encoding ascii

  Write-Output "Deployment directory: $staging"
  Write-Output "Deployment archive: $archive"
  Write-Output "SHA256: $hash"
} finally {
  Pop-Location
}

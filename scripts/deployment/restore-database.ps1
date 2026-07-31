param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [string]$Container = 'hyperzone',
  [string]$Database = 'autoflow',
  [string]$Username = 'autoflow',
  [switch]$ConfirmRestore,
  [switch]$SkipMigrations
)

$ErrorActionPreference = 'Stop'

if (-not $ConfirmRestore) {
  throw "Restore replaces the target database. Re-run with -ConfirmRestore after verifying the backup."
}

$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
$filename = [IO.Path]::GetFileName($resolvedBackup)
$containerPath = "/tmp/$filename"
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

& docker inspect $Container | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker container '$Container' is unavailable."
}

& docker cp $resolvedBackup "${Container}:$containerPath"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to copy the backup into '$Container'."
}

& docker exec $Container dropdb -U $Username --if-exists --force $Database
if ($LASTEXITCODE -ne 0) {
  throw "Unable to drop target database '$Database'."
}

& docker exec $Container createdb -U $Username -O $Username $Database
if ($LASTEXITCODE -ne 0) {
  throw "Unable to create target database '$Database'."
}

& docker exec $Container pg_restore -U $Username -d $Database --no-owner --no-privileges $containerPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore failed with exit code $LASTEXITCODE."
}

& docker exec $Container rm -f $containerPath | Out-Null

if (-not $SkipMigrations) {
  & (Join-Path $PSScriptRoot 'migrate-database.ps1') -Action run
  if ($LASTEXITCODE -ne 0) {
    throw "Database restored, but migration execution failed."
  }
}

Write-Output "Database restore completed: $Database"

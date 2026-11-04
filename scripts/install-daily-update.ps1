param([switch]$WaitForExit)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'artifacts\development\staged-icon-update\win-x64'
$target = Join-Path $root 'artifacts\development\current\win-x64'

$procs = @(Get-Process -Name 'LightNote' -ErrorAction SilentlyContinue)
if ($procs.Count -gt 0) {
    if ($WaitForExit) {
        Write-Host "Waiting for LightNote (PID $($procs[0].Id)) to exit..."
        $procs[0].WaitForExit()
    } else {
        Write-Warning "LightNote is currently running (PID $($procs[0].Id)). Please exit LightNote from tray/window before installing the update."
        exit 1
    }
}

Write-Host "Copying staged package to daily current directory..."
robocopy $source $target /E /NP /NFL /NDL /NJH /NJS
if ($LASTEXITCODE -gt 7) {
    throw "Robocopy failed with exit code $LASTEXITCODE"
}
Write-Host "LightNote daily package updated successfully."

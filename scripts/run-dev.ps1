$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$developmentDirectory = Join-Path $projectRoot "artifacts\development\current\win-x64"
$executablePath = Join-Path $developmentDirectory "LightNote.exe"

if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "未找到当前开发版。请先运行 .\scripts\build-dev.ps1。"
}

$otherInstances = Get-Process "LightNote" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path -ne $executablePath }
if ($otherInstances) {
    $otherPaths = $otherInstances.Path | Sort-Object -Unique
    throw "检测到从其他目录运行的 LightNote，请先关闭：$($otherPaths -join ', ')"
}

$currentInstance = Get-Process "LightNote" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $executablePath } |
    Select-Object -First 1
if ($currentInstance) {
    Write-Host "当前开发版已经运行：$executablePath"
    exit 0
}

Start-Process -FilePath $executablePath -WorkingDirectory $developmentDirectory
Write-Host "已启动当前开发版：$executablePath"

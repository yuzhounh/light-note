param(
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $projectRoot "src\LightNote.App\LightNote.App.csproj"
$editorDirectory = Join-Path $projectRoot "editor"
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "artifacts"))
$outputDirectory = [System.IO.Path]::GetFullPath(
    (Join-Path $artifactsRoot "development\current\win-x64"))

if (-not $outputDirectory.StartsWith(
    $artifactsRoot + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "开发版输出目录不在 artifacts 目录内：$outputDirectory"
}

Push-Location $editorDirectory
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "编辑器构建失败，退出代码：$LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

if (Test-Path -LiteralPath $outputDirectory) {
    Remove-Item -LiteralPath $outputDirectory -Recurse -Force
}

dotnet build $projectPath `
    --configuration $Configuration `
    --output $outputDirectory
if ($LASTEXITCODE -ne 0) {
    throw "开发版构建失败，退出代码：$LASTEXITCODE"
}

$executablePath = Join-Path $outputDirectory "LightNote.exe"
if (-not (Test-Path -LiteralPath $executablePath)) {
    throw "构建完成但未找到开发版入口：$executablePath"
}

Write-Host "当前开发版已生成：$executablePath"

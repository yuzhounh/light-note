param(
    [string]$Version,
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectPath = Join-Path $projectRoot "src\LightNote.App\LightNote.App.csproj"
$installerScript = Join-Path $projectRoot "installer\LightNote.iss"
$solutionPath = Join-Path $projectRoot "LightNote.slnx"
$editorDirectory = Join-Path $projectRoot "editor"
$versionFile = Join-Path $projectRoot "Directory.Build.props"

if ([string]::IsNullOrWhiteSpace($Version)) {
    [xml]$versionDocument = Get-Content -LiteralPath $versionFile
    $Version = [string]$versionDocument.Project.PropertyGroup.Version
}
if ([string]::IsNullOrWhiteSpace($Version)) {
    throw "无法从 Directory.Build.props 读取版本号。"
}
$publishDirectory = Join-Path $projectRoot "artifacts\releases\$Version\win-x64"

Push-Location $editorDirectory
try {
    npm ci
    if ($LASTEXITCODE -ne 0) {
        throw "npm ci 失败，退出代码：$LASTEXITCODE"
    }
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "编辑器构建失败，退出代码：$LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

dotnet restore $solutionPath
if ($LASTEXITCODE -ne 0) {
    throw "dotnet restore 失败，退出代码：$LASTEXITCODE"
}

dotnet test $solutionPath --configuration $Configuration --no-restore
if ($LASTEXITCODE -ne 0) {
    throw "dotnet test 失败，退出代码：$LASTEXITCODE"
}

dotnet publish $projectPath `
    --configuration $Configuration `
    --runtime win-x64 `
    --self-contained true `
    --output $publishDirectory `
    -p:Version=$Version
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish 失败，退出代码：$LASTEXITCODE"
}

$isccCommand = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
$isccPath = if ($isccCommand) {
    $isccCommand.Source
} else {
    $candidatePaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
    )
    $candidatePaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}

if (-not $isccPath) {
    throw "未找到 Inno Setup 6。自包含发布已生成在 $publishDirectory；安装 Inno Setup 后重新运行此脚本即可生成安装包。"
}

& $isccPath "/DMyAppVersion=$Version" $installerScript
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup 编译失败，退出代码：$LASTEXITCODE"
}

$installerPath = Join-Path $projectRoot "artifacts\installers\LightNote-$Version-win-x64-setup.exe"
Write-Host "安装包已生成：$installerPath"

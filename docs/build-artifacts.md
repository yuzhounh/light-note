# 构建产物目录规范

所有可执行构建产物统一放在仓库根目录的 `artifacts` 下，`tmp` 只用于可随时清理的临时文件。

## 固定目录

- `artifacts/development/current/win-x64/`：当前源代码生成的唯一开发版。日常验证只从这里启动。
- `artifacts/releases/<版本>/win-x64/`：按版本保存的自包含正式发布目录。
- `artifacts/installers/`：当前正式安装包。
- `artifacts/archive/`：旧安装包、旧构建和历史验证材料，仅用于追溯，不作为启动入口。

## 固定命令

```powershell
.\scripts\build-dev.ps1
.\scripts\run-dev.ps1
.\scripts\build-installer.ps1
```

`build-dev.ps1` 会重建编辑器并刷新唯一的当前开发版。`run-dev.ps1` 只允许启动该目录中的程序；如果检测到其他目录中的 LightNote 正在运行，会停止并报告路径，避免误开旧版。

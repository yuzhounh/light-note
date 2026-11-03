<p align="center">
  <img src="images/pen-note-icon-green-1024.png" width="112" alt="Light Note logo">
</p>

<h1 align="center">Light Note</h1>

<p align="center"><a href="README.md">简体中文</a> · English</p>

<p align="center"><strong>Local-first Windows & Web note-taking app with full-text search, math formulas, and optional cloud sync.</strong></p>

<p align="center">
  <a href="https://light-note.web.app/"><img src="https://img.shields.io/badge/Website-Firebase-ffca28?style=flat&amp;logo=firebase&amp;logoColor=white" alt="Website: Firebase"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-f59e0b?style=flat" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Platform-Windows-0078d4?style=flat" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/C%23-.NET-512bd4?style=flat&amp;logo=dotnet&amp;logoColor=white" alt="C#: .NET">
</p>

<p align="center">
  <a href="https://light-note.web.app/">Live Web</a> · <a href="https://github.com/yuzhounh/light-note/releases/latest">Releases</a> · <a href="#development">Quick Start</a> · <a href="LICENSE">License</a>
</p>

LightNote is a lightweight, local-first cross-platform note-taking app featuring SQLite FTS5 full-text search, multi-level notebook groups, KaTeX math typesetting, multi-revision version history, Windows system tray, and optional cloud sync.

## Key Features

- **Local-First Speed**: Instant launch, local SQLite storage with FTS5 tokenised full-text indexing.
- **Math & Formatting**: Seamless KaTeX formula rendering, Markdown editing, collapsible sections, and tags.
- **Cross-Platform Access**: Native Windows WPF app with taskbar tray minimization, responsive mobile Web app, and Android packaging.
- **Bilingual Interface**: 1-Click language switching in the desktop user profile dropdown (`[L]` shortcut) and mobile settings drawer.
- **Privacy & Sync**: Zero tracking, fully functional offline, with optional multi-device Firebase cloud synchronization.

## Development

```powershell
# Web frontend
cd web
npm install
npm run dev

# Windows client (.NET 8/9 WPF)
dotnet build
dotnet run
```

## License

[MIT](LICENSE)

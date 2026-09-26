using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;

namespace LightNote.App;

public enum SettingsSection
{
    General,
    ImportExport,
    Backup,
    Safety,
}

public enum SettingsAction
{
    None,
    Import,
    ExportCurrentNote,
    CreateBackup,
    RestoreBackup,
}

public partial class SettingsDialog : Window
{
    private readonly AppSettings _originalSettings;
    private readonly AppDataPaths _paths;
    private readonly SqliteConnectionFactory _connectionFactory;
    private readonly IDatabaseIntegrityChecker _integrityChecker;
    private readonly IBackupService _backupService;
    private readonly Func<Window, Task>? _onImportAsync;
    private readonly Func<Window, Task>? _onExportCurrentNoteAsync;
    private readonly Func<Window, Task>? _onCreateBackupAsync;
    private readonly Func<Window, Task>? _onRestoreBackupAsync;
    private DatabaseIntegrityResult? _lastIntegrityResult;
    private bool _isInitializing = true;

    public SettingsDialog(
        AppSettings settings,
        AppDataPaths paths,
        SqliteConnectionFactory connectionFactory,
        IDatabaseIntegrityChecker integrityChecker,
        IBackupService backupService,
        string syncStatus,
        bool canExportCurrentNote,
        SettingsSection initialSection = SettingsSection.General,
        string? accountEmail = null,
        Func<Window, Task>? onImportAsync = null,
        Func<Window, Task>? onExportCurrentNoteAsync = null,
        Func<Window, Task>? onCreateBackupAsync = null,
        Func<Window, Task>? onRestoreBackupAsync = null)
    {
        InitializeComponent();
        _originalSettings = settings;
        _paths = paths;
        _connectionFactory = connectionFactory;
        _integrityChecker = integrityChecker;
        _backupService = backupService;
        _onImportAsync = onImportAsync;
        _onExportCurrentNoteAsync = onExportCurrentNoteAsync;
        _onCreateBackupAsync = onCreateBackupAsync;
        _onRestoreBackupAsync = onRestoreBackupAsync;

        Settings = settings;

        // 初始化外观与导航状态
        switch (settings.Theme)
        {
            case "dark":
                ThemeDarkRadio.IsChecked = true;
                break;
            case "light":
                ThemeLightRadio.IsChecked = true;
                break;
            default:
                ThemeSystemRadio.IsChecked = true;
                break;
        }

        ShowRecentBox.IsChecked = settings.ShowRecentNavigation;
        ShowPinnedBox.IsChecked = settings.ShowPinnedNavigation;
        ShowTrashBox.IsChecked = settings.ShowTrashNavigation;

        // 初始化备份配置
        AutomaticBackupsBox.IsChecked = settings.AutomaticBackups;
        RetentionBox.Text = settings.BackupRetentionCount.ToString();
        ExportNoteButton.IsEnabled = canExportCurrentNote;
        SyncStatusText.Text = syncStatus;

        // 初始化侧边栏底部软件与版本
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.10.0";
        AppVersionText.Text = $"LightNote v{version}";

        // 初始化存储路径
        BackupsPathText.Text = _paths.BackupsDirectory;
        LogsPathText.Text = _paths.LogsDirectory;

        // 默认定位到初始标签
        SetInitialSection(initialSection);

        _isInitializing = false;
        SourceInitialized += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Loaded += OnLoaded;
    }

    public AppSettings Settings { get; private set; }

    public SettingsAction RequestedAction { get; private set; }

    public bool SettingsSaved { get; private set; }

    private void SetInitialSection(SettingsSection section)
    {
        NavigationList.SelectedItem = section switch
        {
            SettingsSection.General => NavItemGeneral,
            SettingsSection.ImportExport => NavItemImportExport,
            SettingsSection.Backup => NavItemBackup,
            SettingsSection.Safety => NavItemSafety,
            _ => NavItemGeneral,
        };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        WindowNativeHelper.ApplyNativeFrame(this);
        try
        {
            await RefreshSummaryAsync();
        }
        catch (Exception exception)
        {
            DetailsText.Text = $"无法读取数据安全状态：{exception.Message}";
        }
    }

    private void OnNavigationSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (NavigationList.SelectedItem is not ListBoxItem { Tag: string tag })
        {
            return;
        }

        GeneralPage.Visibility = tag == "general" ? Visibility.Visible : Visibility.Collapsed;
        ImportExportPage.Visibility = tag == "import-export" ? Visibility.Visible : Visibility.Collapsed;
        BackupPage.Visibility = tag == "backup" ? Visibility.Visible : Visibility.Collapsed;
        SafetyPage.Visibility = tag == "safety" ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnThemeRadioChecked(object sender, RoutedEventArgs e)
    {
        if (_isInitializing) return;

        var theme = ThemeDarkRadio.IsChecked == true
            ? "dark"
            : ThemeLightRadio.IsChecked == true
                ? "light"
                : "system";

        Settings = Settings with { Theme = theme };
        SettingsSaved = true;

        // 即时应用主题到当前应用上下文，提供无缝换色体验
        if (Application.Current is App app)
        {
            var themeService = new ThemeService();
            themeService.Apply(theme);
            WindowNativeHelper.ApplyNativeFrame(this);
        }
    }

    private void OnNavToggleClicked(object sender, RoutedEventArgs e)
    {
        if (_isInitializing) return;

        Settings = Settings with
        {
            ShowRecentNavigation = ShowRecentBox.IsChecked == true,
            ShowPinnedNavigation = ShowPinnedBox.IsChecked == true,
            ShowTrashNavigation = ShowTrashBox.IsChecked == true,
        };
        SettingsSaved = true;
    }

    private void OnAutoBackupToggleClicked(object sender, RoutedEventArgs e)
    {
        if (_isInitializing) return;

        Settings = Settings with
        {
            AutomaticBackups = AutomaticBackupsBox.IsChecked == true,
        };
        SettingsSaved = true;
    }

    private void OnRetentionTextChanged(object sender, TextChangedEventArgs e)
    {
        if (_isInitializing) return;

        if (int.TryParse(RetentionBox.Text, out var count) && count is >= 1 and <= 100)
        {
            Settings = Settings with { BackupRetentionCount = count };
            SettingsSaved = true;
        }
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        var query = SearchBox.Text?.Trim() ?? string.Empty;
        SearchPlaceholder.Visibility = string.IsNullOrEmpty(query) ? Visibility.Visible : Visibility.Collapsed;

        if (string.IsNullOrEmpty(query))
        {
            NavItemGeneral.Visibility = Visibility.Visible;
            NavItemImportExport.Visibility = Visibility.Visible;
            NavItemBackup.Visibility = Visibility.Visible;
            NavItemSafety.Visibility = Visibility.Visible;
            HeaderPreferences.Visibility = Visibility.Visible;
            return;
        }

        // 智能关键词匹配各模块
        var matchGeneral = MatchesQuery("常规 外观 主题 深色 浅色 快捷导航 最近 置顶 回收站", query);
        var matchImport = MatchesQuery("导入 导出 迁移 enex keep csv markdown html 纯文本 数据", query);
        var matchBackup = MatchesQuery("备份 恢复 还原 自动备份 归档 快照 保留份数 策略", query);
        var matchSafety = MatchesQuery("安全 诊断 完整性 检查 同步 冲突 sqlite 数据库 日志 报告 维护", query);

        NavItemGeneral.Visibility = matchGeneral ? Visibility.Visible : Visibility.Collapsed;
        NavItemImportExport.Visibility = matchImport ? Visibility.Visible : Visibility.Collapsed;
        NavItemBackup.Visibility = matchBackup ? Visibility.Visible : Visibility.Collapsed;
        NavItemSafety.Visibility = matchSafety ? Visibility.Visible : Visibility.Collapsed;
        HeaderPreferences.Visibility = matchGeneral ? Visibility.Visible : Visibility.Collapsed;

        // 如果当前选中的项被隐藏了，自动切换到第一个可见项
        if (NavigationList.SelectedItem is ListBoxItem { Visibility: Visibility.Collapsed })
        {
            if (matchGeneral) NavigationList.SelectedItem = NavItemGeneral;
            else if (matchImport) NavigationList.SelectedItem = NavItemImportExport;
            else if (matchBackup) NavigationList.SelectedItem = NavItemBackup;
            else if (matchSafety) NavigationList.SelectedItem = NavItemSafety;
        }
    }

    private static bool MatchesQuery(string keywords, string query)
    {
        return keywords.Contains(query, StringComparison.OrdinalIgnoreCase) ||
               query.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(part => keywords.Contains(part, StringComparison.OrdinalIgnoreCase));
    }

    private async void OnImportRequestClick(object sender, RoutedEventArgs e)
    {
        if (_onImportAsync is not null)
        {
            await _onImportAsync(this);
            await RefreshSummaryAsync();
        }
        else
        {
            RequestAction(SettingsAction.Import);
        }
    }

    private async void OnExportRequestClick(object sender, RoutedEventArgs e)
    {
        if (_onExportCurrentNoteAsync is not null)
        {
            await _onExportCurrentNoteAsync(this);
        }
        else
        {
            RequestAction(SettingsAction.ExportCurrentNote);
        }
    }

    private async void OnBackupRequestClick(object sender, RoutedEventArgs e)
    {
        if (_onCreateBackupAsync is not null)
        {
            await _onCreateBackupAsync(this);
            await RefreshSummaryAsync();
        }
        else
        {
            RequestAction(SettingsAction.CreateBackup);
        }
    }

    private async void OnRestoreRequestClick(object sender, RoutedEventArgs e)
    {
        if (_onRestoreBackupAsync is not null)
        {
            await _onRestoreBackupAsync(this);
            await RefreshSummaryAsync();
        }
        else
        {
            RequestAction(SettingsAction.RestoreBackup);
        }
    }

    private void RequestAction(SettingsAction action)
    {
        RequestedAction = action;
        DialogResult = true;
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        DialogResult = true;
        Close();
    }

    private async Task RefreshSummaryAsync()
    {
        _paths.EnsureCreated();
        await using var connection = await _connectionFactory.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                (SELECT COUNT(*) FROM sync_outbox),
                (SELECT COUNT(*) FROM note_versions WHERE is_conflict = 1),
                (SELECT COALESCE(MAX(id), 'none') FROM schema_migrations);
            """;
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        PendingCountText.Text = reader.GetInt64(0).ToString();
        ConflictCountText.Text = reader.GetInt64(1).ToString();

        var schemaVersion = reader.GetString(2);
        DbVersionText.Text = schemaVersion;

        var dbFileInfo = new FileInfo(_paths.DatabasePath);
        DbSizeText.Text = dbFileInfo.Exists ? FormatBytes(dbFileInfo.Length) : "0 B";

        var latestBackup = GetLatestBackup();
        BackupStatusText.Text = latestBackup is null
            ? "尚未找到备份文件"
            : $"最近备份：{latestBackup.LastWriteTime.ToLocalTime():yyyy-MM-dd HH:mm}";

        DetailsText.Text = $"数据库迁移版本：{schemaVersion}{Environment.NewLine}" +
                           $"数据库大小：{DbSizeText.Text}{Environment.NewLine}" +
                           $"备份目录：{_paths.BackupsDirectory}";
    }

    private async void OnCheckClick(object sender, RoutedEventArgs e)
    {
        IntegrityStatusText.Text = "正在检查…";
        try
        {
            _lastIntegrityResult = await _integrityChecker.CheckAsync();
            IntegrityStatusText.Text = _lastIntegrityResult.IsHealthy
                ? _lastIntegrityResult.Warnings.Count == 0 ? "检查通过" : "检查通过，有提示"
                : "检查失败";
            await RefreshSummaryAsync();
            DetailsText.Text = _lastIntegrityResult.Warnings.Count == 0
                ? "数据库结构、索引与附件文件检查通过。"
                : string.Join(Environment.NewLine, _lastIntegrityResult.Warnings);
        }
        catch (Exception exception)
        {
            IntegrityStatusText.Text = "检查失败";
            DetailsText.Text = exception.Message;
        }
    }

    private void OnOpenBackupsClick(object sender, RoutedEventArgs e) => OpenDirectory(_paths.BackupsDirectory);

    private void OnOpenLogsClick(object sender, RoutedEventArgs e) => OpenDirectory(_paths.LogsDirectory);

    private async void OnValidateBackupClick(object sender, RoutedEventArgs e)
    {
        var latestBackup = GetLatestBackup();
        if (latestBackup is null)
        {
            MessageBox.Show(this, "尚未找到可验证的备份。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var validationDirectory = Path.Combine(
            Path.GetTempPath(),
            "LightNote.Backup.Validation",
            Guid.NewGuid().ToString("N"));
        try
        {
            BackupStatusText.Text = "正在完整验证最近备份…";
            await _backupService.RestoreAsync(latestBackup.FullName, validationDirectory);
            BackupStatusText.Text = $"备份验证通过：{latestBackup.LastWriteTime:yyyy-MM-dd HH:mm}";
            DetailsText.Text = $"已验证归档结构、文件大小、SHA-256 与 SQLite quick_check。{Environment.NewLine}" +
                               latestBackup.Name;
        }
        catch (Exception exception)
        {
            BackupStatusText.Text = "最近备份验证失败";
            DetailsText.Text = exception.Message;
        }
        finally
        {
            if (Directory.Exists(validationDirectory))
            {
                Directory.Delete(validationDirectory, recursive: true);
            }
        }
    }

    private async void OnCreateDiagnosticClick(object sender, RoutedEventArgs e)
    {
        try
        {
            _lastIntegrityResult ??= await _integrityChecker.CheckAsync();
            var snapshot = await ReadDiagnosticSnapshotAsync();
            var outputPath = Path.Combine(
                _paths.BackupsDirectory,
                $"LightNote-diagnostics-{DateTime.Now:yyyyMMdd-HHmmss}.zip");
            var report = BuildDiagnosticReport(snapshot, _lastIntegrityResult);
            await using var stream = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
            {
                var entry = archive.CreateEntry("diagnostic.txt", CompressionLevel.Optimal);
                await using var entryStream = entry.Open();
                await using var writer = new StreamWriter(entryStream, new UTF8Encoding(false));
                await writer.WriteAsync(report);
            }

            MessageBox.Show(this,
                $"脱敏诊断包已生成，不包含笔记正文、Firebase 配置或登录令牌：\n{outputPath}",
                "LightNote", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, $"无法生成诊断包：{exception.Message}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async Task<DiagnosticSnapshot> ReadDiagnosticSnapshotAsync()
    {
        await using var connection = await _connectionFactory.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                (SELECT COUNT(*) FROM notes WHERE purged_at IS NULL),
                (SELECT COUNT(*) FROM notebooks WHERE deleted_at IS NULL),
                (SELECT COUNT(*) FROM attachments WHERE purged_at IS NULL),
                (SELECT COUNT(*) FROM sync_outbox),
                (SELECT COUNT(*) FROM note_versions WHERE is_conflict = 1),
                (SELECT COALESCE(MAX(id), 'none') FROM schema_migrations);
            """;
        await using var reader = await command.ExecuteReaderAsync();
        await reader.ReadAsync();
        return new DiagnosticSnapshot(
            reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2),
            reader.GetInt64(3), reader.GetInt64(4), reader.GetString(5));
    }

    private static string BuildDiagnosticReport(
        DiagnosticSnapshot snapshot,
        DatabaseIntegrityResult integrity)
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "unknown";
        var builder = new StringBuilder()
            .AppendLine("LightNote 脱敏诊断报告")
            .AppendLine($"生成时间（UTC）：{DateTimeOffset.UtcNow:O}")
            .AppendLine($"应用版本：{version}")
            .AppendLine($"操作系统：{Environment.OSVersion}")
            .AppendLine($".NET：{Environment.Version}")
            .AppendLine($"数据库迁移版本：{snapshot.SchemaVersion}")
            .AppendLine($"笔记数：{snapshot.NoteCount}")
            .AppendLine($"笔记本数：{snapshot.NotebookCount}")
            .AppendLine($"附件数：{snapshot.AttachmentCount}")
            .AppendLine($"待同步项目：{snapshot.PendingSyncCount}")
            .AppendLine($"冲突副本：{snapshot.ConflictCount}")
            .AppendLine($"完整性：{(integrity.IsHealthy ? "通过" : "失败")}");
        foreach (var warning in integrity.Warnings)
        {
            builder.AppendLine($"完整性提示：{warning}");
        }
        builder.AppendLine("隐私说明：本报告不包含笔记标题、正文、附件内容、账号、Firebase 配置或登录令牌。");
        return builder.ToString();
    }

    private static string FormatBytes(long value) => value switch
    {
        >= 1024 * 1024 => $"{value / 1024d / 1024d:F1} MB",
        >= 1024 => $"{value / 1024d:F1} KB",
        _ => $"{value} B",
    };

    private FileInfo? GetLatestBackup() => Directory.EnumerateFiles(_paths.BackupsDirectory, "*.zip")
        .Where(path => Path.GetFileName(path).StartsWith("LightNote-backup-", StringComparison.OrdinalIgnoreCase) ||
                       Path.GetFileName(path).StartsWith("LightNote-auto-", StringComparison.OrdinalIgnoreCase))
        .Select(path => new FileInfo(path))
        .OrderByDescending(info => info.LastWriteTimeUtc)
        .FirstOrDefault();

    private void OpenDirectory(string path)
    {
        try
        {
            Directory.CreateDirectory(path);
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
        }
        catch (Exception exception)
        {
            MessageBox.Show(this, $"无法打开目录：{exception.Message}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private sealed record DiagnosticSnapshot(
        long NoteCount,
        long NotebookCount,
        long AttachmentCount,
        long PendingSyncCount,
        long ConflictCount,
        string SchemaVersion);
}

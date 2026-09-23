using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;

namespace LightNote.App;

public enum SettingsSection
{
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
    private DatabaseIntegrityResult? _lastIntegrityResult;

    public SettingsDialog(
        AppSettings settings,
        AppDataPaths paths,
        SqliteConnectionFactory connectionFactory,
        IDatabaseIntegrityChecker integrityChecker,
        IBackupService backupService,
        string syncStatus,
        bool canExportCurrentNote,
        SettingsSection initialSection = SettingsSection.ImportExport)
    {
        InitializeComponent();
        _originalSettings = settings;
        _paths = paths;
        _connectionFactory = connectionFactory;
        _integrityChecker = integrityChecker;
        _backupService = backupService;

        Settings = settings;
        AutomaticBackupsBox.IsChecked = settings.AutomaticBackups;
        RetentionBox.Text = settings.BackupRetentionCount.ToString();
        ExportNoteButton.IsEnabled = canExportCurrentNote;
        SyncStatusText.Text = syncStatus;
        VersionText.Text = $"版本 {Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "unknown"}";
        NavigationList.SelectedIndex = (int)initialSection;
        Loaded += OnLoaded;
    }

    public AppSettings Settings { get; private set; }

    public SettingsAction RequestedAction { get; private set; }

    public bool SettingsSaved { get; private set; }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
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

        ImportExportPage.Visibility = tag == "import-export" ? Visibility.Visible : Visibility.Collapsed;
        BackupPage.Visibility = tag == "backup" ? Visibility.Visible : Visibility.Collapsed;
        SafetyPage.Visibility = tag == "safety" ? Visibility.Visible : Visibility.Collapsed;
    }

    private void OnImportRequestClick(object sender, RoutedEventArgs e) =>
        RequestAction(SettingsAction.Import);

    private void OnExportRequestClick(object sender, RoutedEventArgs e) =>
        RequestAction(SettingsAction.ExportCurrentNote);

    private void OnBackupRequestClick(object sender, RoutedEventArgs e) =>
        RequestAction(SettingsAction.CreateBackup);

    private void OnRestoreRequestClick(object sender, RoutedEventArgs e) =>
        RequestAction(SettingsAction.RestoreBackup);

    private void RequestAction(SettingsAction action)
    {
        RequestedAction = action;
        DialogResult = true;
    }

    private void OnSaveClick(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(RetentionBox.Text, out var retentionCount) || retentionCount is < 1 or > 100)
        {
            MessageBox.Show(this, "自动备份保留份数请输入 1 到 100 之间的整数。", "LightNote 设置",
                MessageBoxButton.OK, MessageBoxImage.Information);
            NavigationList.SelectedIndex = (int)SettingsSection.Backup;
            RetentionBox.Focus();
            RetentionBox.SelectAll();
            return;
        }

        Settings = _originalSettings with
        {
            AutomaticBackups = AutomaticBackupsBox.IsChecked == true,
            BackupRetentionCount = retentionCount,
        };
        SettingsSaved = true;
        DialogResult = true;
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

        var latestBackup = GetLatestBackup();
        BackupStatusText.Text = latestBackup is null
            ? "尚未找到备份"
            : $"最近备份：{latestBackup.LastWriteTime.ToLocalTime():yyyy-MM-dd HH:mm}";
        DetailsText.Text = $"数据库迁移版本：{reader.GetString(2)}{Environment.NewLine}" +
                           $"数据库大小：{FormatBytes(new FileInfo(_paths.DatabasePath).Length)}{Environment.NewLine}" +
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

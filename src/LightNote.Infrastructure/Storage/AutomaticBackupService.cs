using LightNote.Infrastructure.Settings;

namespace LightNote.Infrastructure.Storage;

public sealed class AutomaticBackupService(
    AppDataPaths paths,
    BackupService backupService,
    AppSettingsService settingsService)
{
    public async Task<string?> RunIfDueAsync(CancellationToken cancellationToken = default)
    {
        var settings = settingsService.Load();
        if (!settings.AutomaticBackups || !File.Exists(paths.DatabasePath))
        {
            return null;
        }

        paths.EnsureCreated();
        var automaticBackups = Directory.EnumerateFiles(
                paths.BackupsDirectory,
                "LightNote-auto-*.zip",
                SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.CreationTimeUtc)
            .ToArray();
        if (automaticBackups.FirstOrDefault()?.CreationTimeUtc > DateTime.UtcNow.AddHours(-24))
        {
            return null;
        }

        var createdPath = await backupService.CreateAutomaticAsync(cancellationToken);
        automaticBackups = Directory.EnumerateFiles(
                paths.BackupsDirectory,
                "LightNote-auto-*.zip",
                SearchOption.TopDirectoryOnly)
            .Select(path => new FileInfo(path))
            .OrderByDescending(file => file.CreationTimeUtc)
            .ToArray();
        foreach (var expired in automaticBackups.Skip(settings.BackupRetentionCount))
        {
            expired.Delete();
        }

        return createdPath;
    }
}

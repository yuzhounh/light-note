using LightNote.Infrastructure.Settings;

namespace LightNote.Infrastructure.Storage;

public sealed class AutomaticBackupService(
    AppDataPaths paths,
    BackupService backupService,
    AppSettingsService settingsService,
    SqliteConnectionFactory? connectionFactory = null)
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

        // 数据库和附件自上一份自动备份以来没有任何变化时，不再重复生成相同内容的备份。
        var fingerprint = await ComputeContentFingerprintAsync(cancellationToken);
        var fingerprintPath = Path.Combine(paths.BackupsDirectory, FingerprintFileName);
        if (automaticBackups.Length > 0 &&
            File.Exists(fingerprintPath) &&
            string.Equals(File.ReadAllText(fingerprintPath).Trim(), fingerprint, StringComparison.Ordinal))
        {
            return null;
        }

        var createdPath = await backupService.CreateAutomaticAsync(cancellationToken);
        File.WriteAllText(fingerprintPath, fingerprint);
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

    private const string FingerprintFileName = ".auto-backup-state";

    private async Task<string> ComputeContentFingerprintAsync(CancellationToken cancellationToken)
    {
        var builder = new System.Text.StringBuilder();
        if (connectionFactory is not null)
        {
            // 用数据内容而不是文件时间判断：SQLite 检查点会改变数据库文件的时间，但数据没变。
            await using var connection = await connectionFactory.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT
                    (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') || ':' || COALESCE(SUM(version), 0) FROM notes),
                    (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM notebooks),
                    (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM attachments),
                    (SELECT COUNT(*) FROM tags),
                    (SELECT COUNT(*) FROM note_tags),
                    (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM notebook_groups),
                    (SELECT COUNT(*) FROM notebook_group_memberships);
                """;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                for (var index = 0; index < reader.FieldCount; index++)
                {
                    builder.Append(Convert.ToString(reader.GetValue(index), System.Globalization.CultureInfo.InvariantCulture)).Append('|');
                }
            }
        }
        else
        {
            var info = new FileInfo(paths.DatabasePath);
            builder.Append(info.Exists ? $"{info.Length}:{info.LastWriteTimeUtc.Ticks}" : "-").Append('|');
        }

        if (Directory.Exists(paths.AttachmentsDirectory))
        {
            foreach (var file in Directory.EnumerateFiles(paths.AttachmentsDirectory, "*", SearchOption.AllDirectories)
                         .Select(path => new FileInfo(path))
                         .OrderBy(file => file.FullName, StringComparer.Ordinal))
            {
                builder.Append(file.FullName).Append(':').Append(file.Length).Append(':')
                    .Append(file.LastWriteTimeUtc.Ticks).Append('|');
            }
        }

        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(builder.ToString())));
    }
}

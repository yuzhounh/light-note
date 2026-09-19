using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using LightNote.Core.Abstractions;
using Microsoft.Data.Sqlite;

namespace LightNote.Infrastructure.Storage;

public sealed class BackupService(
    AppDataPaths paths,
    SqliteConnectionFactory connectionFactory) : IBackupService
{
    private const int MaximumArchiveEntries = 10000;
    private const long MaximumExpandedBytes = 20L * 1024 * 1024 * 1024;

    public async Task<string> CreateAsync(CancellationToken cancellationToken = default)
        => await CreateArchiveAsync("LightNote-backup", cancellationToken);

    public async Task<string> CreateAutomaticAsync(CancellationToken cancellationToken = default)
        => await CreateArchiveAsync("LightNote-auto", cancellationToken);

    private async Task<string> CreateArchiveAsync(
        string fileNamePrefix,
        CancellationToken cancellationToken)
    {
        paths.EnsureCreated();
        var temporaryDirectory = Path.Combine(
            Path.GetTempPath(),
            "LightNote.Backup",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporaryDirectory);
        try
        {
            var databaseCopy = Path.Combine(temporaryDirectory, "lightnote.db");
            await using (var source = await connectionFactory.OpenAsync(cancellationToken))
            await using (var destination = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = databaseCopy,
                Pooling = false,
            }.ToString()))
            {
                await destination.OpenAsync(cancellationToken);
                source.BackupDatabase(destination);
            }

            var archivePath = Path.Combine(
                paths.BackupsDirectory,
                $"{fileNamePrefix}-{DateTime.Now:yyyyMMdd-HHmmss-fff}.zip");
            var temporaryArchivePath = $"{archivePath}.{Guid.NewGuid():N}.tmp";
            try
            {
                var files = new List<BackupManifestEntry>();
                await using (var archiveStream = new FileStream(
                                 temporaryArchivePath,
                                 FileMode.CreateNew,
                                 FileAccess.ReadWrite,
                                 FileShare.None,
                                 81920,
                                 useAsync: true))
                using (var archive = new ZipArchive(archiveStream, ZipArchiveMode.Create, leaveOpen: true))
                {
                    await AddFileAsync(archive, databaseCopy, "lightnote.db", cancellationToken);
                    files.Add(await DescribeFileAsync(databaseCopy, "lightnote.db", cancellationToken));

                    if (Directory.Exists(paths.AttachmentsDirectory))
                    {
                        foreach (var attachmentPath in Directory.EnumerateFiles(
                                     paths.AttachmentsDirectory,
                                     "*",
                                     SearchOption.AllDirectories))
                        {
                            cancellationToken.ThrowIfCancellationRequested();
                            var relativePath = Path.GetRelativePath(paths.AttachmentsDirectory, attachmentPath)
                                .Replace(Path.DirectorySeparatorChar, '/');
                            var entryName = $"attachments/{relativePath}";
                            await AddFileAsync(archive, attachmentPath, entryName, cancellationToken);
                            files.Add(await DescribeFileAsync(attachmentPath, entryName, cancellationToken));
                        }
                    }

                    var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
                    await using var manifestStream = manifestEntry.Open();
                    await JsonSerializer.SerializeAsync(
                        manifestStream,
                        new BackupManifest(
                            "LightNote Backup",
                            2,
                            typeof(BackupService).Assembly.GetName().Version?.ToString() ?? "unknown",
                            DateTimeOffset.UtcNow,
                            files),
                        cancellationToken: cancellationToken);
                }

                await ValidateArchiveStructureAsync(temporaryArchivePath, cancellationToken);
                File.Move(temporaryArchivePath, archivePath, overwrite: false);
                return archivePath;
            }
            finally
            {
                if (File.Exists(temporaryArchivePath))
                {
                    File.Delete(temporaryArchivePath);
                }
            }
        }
        finally
        {
            if (Directory.Exists(temporaryDirectory))
            {
                Directory.Delete(temporaryDirectory, recursive: true);
            }
        }
    }

    public async Task RestoreAsync(
        string archivePath,
        string emptyTargetDirectory,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(archivePath))
        {
            throw new FileNotFoundException("找不到备份文件。", archivePath);
        }

        var targetRoot = Path.GetFullPath(emptyTargetDirectory);
        if (Directory.Exists(targetRoot) && Directory.EnumerateFileSystemEntries(targetRoot).Any())
        {
            throw new InvalidOperationException("恢复目标目录必须为空。");
        }

        var parentDirectory = Directory.GetParent(targetRoot)?.FullName
            ?? throw new InvalidOperationException("恢复目标目录不能是磁盘根目录。");
        var stagingDirectory = Path.Combine(
            parentDirectory,
            $".lightnote-restore-{Guid.NewGuid():N}");
        Directory.CreateDirectory(stagingDirectory);
        try
        {
            BackupManifest manifest;
            using (var archive = ZipFile.OpenRead(archivePath))
            {
                manifest = await ReadManifestAsync(archive, cancellationToken);
                ValidateArchiveLimits(archive);
                foreach (var entry in archive.Entries)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (string.Equals(entry.FullName, "manifest.json", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var destinationPath = ResolveArchiveDestination(stagingDirectory, entry.FullName);
                    if (entry.FullName.EndsWith('/'))
                    {
                        Directory.CreateDirectory(destinationPath);
                        continue;
                    }

                    Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
                    await using var source = entry.Open();
                    await using var destination = new FileStream(
                        destinationPath,
                        FileMode.CreateNew,
                        FileAccess.Write,
                        FileShare.None,
                        81920,
                        useAsync: true);
                    await source.CopyToAsync(destination, cancellationToken);
                }
            }

            await ValidateRestoredContentAsync(stagingDirectory, manifest, cancellationToken);
            if (Directory.Exists(targetRoot))
            {
                Directory.Delete(targetRoot, recursive: false);
            }

            Directory.Move(stagingDirectory, targetRoot);
        }
        finally
        {
            if (Directory.Exists(stagingDirectory))
            {
                Directory.Delete(stagingDirectory, recursive: true);
            }
        }
    }

    private static async Task AddFileAsync(
        ZipArchive archive,
        string sourcePath,
        string entryName,
        CancellationToken cancellationToken)
    {
        var entry = archive.CreateEntry(entryName, CompressionLevel.Optimal);
        await using var source = new FileStream(
            sourcePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            81920,
            useAsync: true);
        await using var destination = entry.Open();
        await source.CopyToAsync(destination, cancellationToken);
    }

    private static async Task<BackupManifestEntry> DescribeFileAsync(
        string sourcePath,
        string entryName,
        CancellationToken cancellationToken) =>
        new(
            entryName,
            new FileInfo(sourcePath).Length,
            await ComputeSha256Async(sourcePath, cancellationToken));

    private static async Task<string> ComputeSha256Async(
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            81920,
            useAsync: true);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken));
    }

    private static async Task ValidateArchiveStructureAsync(
        string archivePath,
        CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(archivePath);
        ValidateArchiveLimits(archive);
        _ = await ReadManifestAsync(archive, cancellationToken);
        if (archive.GetEntry("lightnote.db") is null)
        {
            throw new InvalidDataException("备份中缺少数据库文件。");
        }
    }

    private static void ValidateArchiveLimits(ZipArchive archive)
    {
        if (archive.Entries.Count > MaximumArchiveEntries ||
            archive.Entries.Sum(entry => entry.Length) > MaximumExpandedBytes)
        {
            throw new InvalidDataException("备份条目数或解压后大小超过安全限制。");
        }
    }

    private static async Task<BackupManifest> ReadManifestAsync(
        ZipArchive archive,
        CancellationToken cancellationToken)
    {
        var entry = archive.GetEntry("manifest.json")
            ?? throw new InvalidDataException("备份中缺少 manifest.json。");
        await using var stream = entry.Open();
        var manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(
            stream,
            cancellationToken: cancellationToken)
            ?? throw new InvalidDataException("备份 manifest 无效。");
        if (!string.Equals(manifest.Format, "LightNote Backup", StringComparison.Ordinal) ||
            manifest.Version is < 1 or > 2)
        {
            throw new InvalidDataException("备份格式或版本不受支持。");
        }

        return manifest;
    }

    private static string ResolveArchiveDestination(string rootDirectory, string entryName)
    {
        var root = Path.GetFullPath(rootDirectory) + Path.DirectorySeparatorChar;
        var destination = Path.GetFullPath(Path.Combine(
            rootDirectory,
            entryName.Replace('/', Path.DirectorySeparatorChar)));
        if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("备份中包含不安全的路径。");
        }

        return destination;
    }

    private static async Task ValidateRestoredContentAsync(
        string stagingDirectory,
        BackupManifest manifest,
        CancellationToken cancellationToken)
    {
        var databasePath = Path.Combine(stagingDirectory, "lightnote.db");
        if (!File.Exists(databasePath))
        {
            throw new InvalidDataException("备份中缺少数据库文件。");
        }

        if (manifest.Version >= 2)
        {
            foreach (var file in manifest.Files ?? [])
            {
                var path = ResolveArchiveDestination(stagingDirectory, file.Path);
                if (!File.Exists(path) ||
                    new FileInfo(path).Length != file.Size ||
                    !string.Equals(
                        await ComputeSha256Async(path, cancellationToken),
                        file.Sha256,
                        StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException($"备份文件校验失败：{file.Path}");
                }
            }
        }

        await using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Pooling = false,
        }.ToString());
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA quick_check;";
        var result = (string?)await command.ExecuteScalarAsync(cancellationToken);
        if (!string.Equals(result, "ok", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"备份数据库完整性检查失败：{result ?? "无结果"}");
        }
    }

    private sealed record BackupManifest(
        [property: JsonPropertyName("format")] string Format,
        [property: JsonPropertyName("version")] int Version,
        [property: JsonPropertyName("appVersion")] string? AppVersion,
        [property: JsonPropertyName("createdAtUtc")] DateTimeOffset CreatedAtUtc,
        [property: JsonPropertyName("files")] IReadOnlyList<BackupManifestEntry>? Files);

    private sealed record BackupManifestEntry(
        [property: JsonPropertyName("path")] string Path,
        [property: JsonPropertyName("size")] long Size,
        [property: JsonPropertyName("sha256")] string Sha256);
}

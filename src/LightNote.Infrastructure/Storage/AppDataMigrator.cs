using System.Globalization;
using Microsoft.Data.Sqlite;

namespace LightNote.Infrastructure.Storage;

public sealed record AppDataMigrationResult(string SourceDirectory, int NoteCount);

public static class AppDataMigrator
{
    private const string DatabaseFileName = "lightnote.db";

    public static string GetStableRootDirectory(string userProfile)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(userProfile);
        return Path.Combine(userProfile, ".lightnote");
    }

    public static IReadOnlyList<string> DiscoverLegacyDirectories(string userProfile)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(userProfile);
        var localAppData = Path.Combine(userProfile, "AppData", "Local");
        var directories = new List<string>
        {
            Path.Combine(localAppData, "LightNote"),
        };
        var packagesDirectory = Path.Combine(localAppData, "Packages");
        if (Directory.Exists(packagesDirectory))
        {
            foreach (var packageDirectory in Directory.EnumerateDirectories(packagesDirectory))
            {
                var candidate = Path.Combine(packageDirectory, "LocalCache", "Local", "LightNote");
                if (Directory.Exists(candidate))
                {
                    directories.Add(candidate);
                }
            }
        }

        return directories;
    }

    public static AppDataMigrationResult? MigrateIfNeeded(
        string destinationDirectory,
        IEnumerable<string> candidateDirectories)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationDirectory);
        ArgumentNullException.ThrowIfNull(candidateDirectories);
        var destination = Path.GetFullPath(destinationDirectory);
        if (File.Exists(Path.Combine(destination, DatabaseFileName)))
        {
            return null;
        }

        var candidates = candidateDirectories
            .Select(Path.GetFullPath)
            .Where(candidate => !string.Equals(candidate, destination, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(InspectCandidate)
            .Where(candidate => candidate is not null)
            .Cast<MigrationCandidate>()
            .OrderByDescending(candidate => candidate.NoteCount)
            .ThenByDescending(candidate => candidate.DatabaseLength)
            .ThenByDescending(candidate => candidate.LastWriteTimeUtc)
            .ToArray();
        if (candidates.Length == 0)
        {
            return null;
        }

        Exception? lastError = null;
        foreach (var candidate in candidates)
        {
            try
            {
                MigrateCandidate(candidate.Directory, destination);
                return new AppDataMigrationResult(candidate.Directory, candidate.NoteCount);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or SqliteException)
            {
                lastError = exception;
            }
        }

        throw new IOException("无法将现有 LightNote 数据迁移到稳定数据目录。", lastError);
    }

    private static MigrationCandidate? InspectCandidate(string directory)
    {
        var databasePath = Path.Combine(directory, DatabaseFileName);
        if (!File.Exists(databasePath))
        {
            return null;
        }

        try
        {
            var connectionString = new SqliteConnectionStringBuilder
            {
                DataSource = databasePath,
                Mode = SqliteOpenMode.ReadOnly,
                Cache = SqliteCacheMode.Private,
                Pooling = false,
            }.ToString();
            using var connection = new SqliteConnection(connectionString);
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM notes;";
            var noteCount = Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
            var info = new FileInfo(databasePath);
            return new MigrationCandidate(directory, noteCount, info.Length, info.LastWriteTimeUtc);
        }
        catch (SqliteException)
        {
            return null;
        }
    }

    private static void MigrateCandidate(string sourceDirectory, string destinationDirectory)
    {
        var parentDirectory = Directory.GetParent(destinationDirectory)?.FullName
            ?? throw new IOException("无法确定 LightNote 数据目录的父目录。");
        Directory.CreateDirectory(parentDirectory);
        var stagingDirectory = Path.Combine(
            parentDirectory,
            $".{Path.GetFileName(destinationDirectory)}-migration-{Guid.NewGuid():N}");
        Directory.CreateDirectory(stagingDirectory);

        try
        {
            BackupDatabase(
                Path.Combine(sourceDirectory, DatabaseFileName),
                Path.Combine(stagingDirectory, DatabaseFileName));
            CopyAncillaryFiles(sourceDirectory, stagingDirectory);

            Directory.CreateDirectory(destinationDirectory);
            CopyFiles(stagingDirectory, destinationDirectory, includeDatabase: false);
            var stagedDatabase = Path.Combine(stagingDirectory, DatabaseFileName);
            var destinationDatabase = Path.Combine(destinationDirectory, DatabaseFileName);
            File.Move(stagedDatabase, destinationDatabase, overwrite: false);
        }
        finally
        {
            if (Directory.Exists(stagingDirectory))
            {
                Directory.Delete(stagingDirectory, recursive: true);
            }
        }
    }

    private static void BackupDatabase(string sourcePath, string destinationPath)
    {
        var sourceConnectionString = new SqliteConnectionStringBuilder
        {
            DataSource = sourcePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString();
        var destinationConnectionString = new SqliteConnectionStringBuilder
        {
            DataSource = destinationPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString();
        using var source = new SqliteConnection(sourceConnectionString);
        using var destination = new SqliteConnection(destinationConnectionString);
        source.Open();
        destination.Open();
        source.BackupDatabase(destination);
    }

    private static void CopyAncillaryFiles(string sourceDirectory, string destinationDirectory)
    {
        foreach (var sourcePath in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(sourceDirectory, sourcePath);
            if (ShouldSkip(relativePath))
            {
                continue;
            }

            var destinationPath = Path.Combine(destinationDirectory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            File.Copy(sourcePath, destinationPath, overwrite: false);
        }
    }

    private static void CopyFiles(string sourceDirectory, string destinationDirectory, bool includeDatabase)
    {
        foreach (var sourcePath in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            var relativePath = Path.GetRelativePath(sourceDirectory, sourcePath);
            if (!includeDatabase && string.Equals(relativePath, DatabaseFileName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var destinationPath = Path.Combine(destinationDirectory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            if (!File.Exists(destinationPath))
            {
                File.Copy(sourcePath, destinationPath, overwrite: false);
            }
        }
    }

    private static bool ShouldSkip(string relativePath)
    {
        var segments = relativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (segments.Length > 0 &&
            (string.Equals(segments[0], "webview2", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(segments[0], "logs", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        var fileName = Path.GetFileName(relativePath);
        return string.Equals(fileName, DatabaseFileName, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(fileName, $"{DatabaseFileName}-wal", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(fileName, $"{DatabaseFileName}-shm", StringComparison.OrdinalIgnoreCase);
    }

    private sealed record MigrationCandidate(
        string Directory,
        int NoteCount,
        long DatabaseLength,
        DateTime LastWriteTimeUtc);
}

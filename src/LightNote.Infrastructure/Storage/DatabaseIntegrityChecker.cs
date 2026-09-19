using System.Security.Cryptography;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.Infrastructure.Storage;

public sealed class DatabaseIntegrityChecker(
    AppDataPaths paths,
    SqliteConnectionFactory connectionFactory) : IDatabaseIntegrityChecker
{
    public async Task<DatabaseIntegrityResult> CheckAsync(
        CancellationToken cancellationToken = default)
    {
        var warnings = new List<string>();
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);

        await using (var integrityCommand = connection.CreateCommand())
        {
            integrityCommand.CommandText = "PRAGMA quick_check;";
            await using var reader = await integrityCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var result = reader.GetString(0);
                if (!string.Equals(result, "ok", StringComparison.OrdinalIgnoreCase))
                {
                    warnings.Add($"SQLite 完整性检查失败：{result}");
                }
            }
        }

        if (warnings.Count > 0)
        {
            return new DatabaseIntegrityResult { IsHealthy = false, Warnings = warnings };
        }

        await using var attachmentCommand = connection.CreateCommand();
        attachmentCommand.CommandText = """
            SELECT id, relative_path, size, sha256
            FROM attachments
            WHERE deleted_at IS NULL AND purged_at IS NULL;
            """;
        await using var attachmentReader = await attachmentCommand.ExecuteReaderAsync(cancellationToken);
        while (await attachmentReader.ReadAsync(cancellationToken))
        {
            var attachmentId = attachmentReader.GetString(0);
            var relativePath = attachmentReader.GetString(1).Replace('/', Path.DirectorySeparatorChar);
            var absolutePath = Path.GetFullPath(Path.Combine(paths.AttachmentsDirectory, relativePath));
            if (!absolutePath.StartsWith(
                    Path.GetFullPath(paths.AttachmentsDirectory) + Path.DirectorySeparatorChar,
                    StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(absolutePath))
            {
                warnings.Add($"附件缺失：{attachmentId}");
                continue;
            }

            var expectedSize = attachmentReader.GetInt64(2);
            if (new FileInfo(absolutePath).Length != expectedSize)
            {
                warnings.Add($"附件大小不匹配：{attachmentId}");
                continue;
            }

            await using var stream = new FileStream(
                absolutePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                81920,
                useAsync: true);
            var actualHash = Convert.ToHexStringLower(
                await SHA256.HashDataAsync(stream, cancellationToken));
            if (!string.Equals(
                    actualHash,
                    attachmentReader.GetString(3),
                    StringComparison.OrdinalIgnoreCase))
            {
                warnings.Add($"附件 SHA-256 不匹配：{attachmentId}");
            }
        }

        return new DatabaseIntegrityResult { IsHealthy = true, Warnings = warnings };
    }
}

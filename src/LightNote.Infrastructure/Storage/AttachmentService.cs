using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.Infrastructure.Storage;

public sealed class AttachmentService(
    AppDataPaths paths,
    SqliteConnectionFactory connectionFactory) : IAttachmentService
{
    private const int MaxImageBytes = 20 * 1024 * 1024;
    private static readonly TimeSpan GarbageCollectionDelay = TimeSpan.FromHours(24);
    private static readonly Regex ImageSourcePattern = new(
        "src\\s*=\\s*[\\\"'](?<url>https://lightnote\\.attachments/[^\\\"']+)[\\\"']",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private readonly SemaphoreSlim _fileGate = new(1, 1);

    public async Task<AttachmentImportResult> ImportAsync(
        string noteId,
        string fileName,
        string declaredMimeType,
        byte[] content,
        CancellationToken cancellationToken = default)
    {
        if (content.Length == 0 || content.Length > MaxImageBytes)
        {
            throw new InvalidDataException("图片大小必须在 1 字节到 20 MB 之间。");
        }

        await EnsureNoteExistsAsync(noteId, cancellationToken);
        var image = DetectImage(content, fileName, declaredMimeType);
        var hash = Convert.ToHexStringLower(SHA256.HashData(content));
        var relativePath = $"{hash[..2]}/{hash}.{image.Extension}";
        var absolutePath = ResolveAttachmentPath(relativePath);
        var now = DateTimeOffset.UtcNow.ToString("O");

        await _fileGate.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);
            if (!File.Exists(absolutePath))
            {
                var temporaryPath = $"{absolutePath}.{Guid.NewGuid():N}.tmp";
                try
                {
                    await File.WriteAllBytesAsync(temporaryPath, content, cancellationToken);
                    File.Move(temporaryPath, absolutePath, overwrite: false);
                }
                finally
                {
                    if (File.Exists(temporaryPath))
                    {
                        File.Delete(temporaryPath);
                    }
                }
            }
        }
        finally
        {
            _fileGate.Release();
        }

        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();

        string attachmentId;
        await using (var existingCommand = connection.CreateCommand())
        {
            existingCommand.Transaction = transaction;
            existingCommand.CommandText = """
                SELECT id FROM attachments
                WHERE note_id = $noteId AND sha256 = $sha256
                LIMIT 1;
                """;
            existingCommand.Parameters.AddWithValue("$noteId", noteId);
            existingCommand.Parameters.AddWithValue("$sha256", hash);
            attachmentId = (string?)await existingCommand.ExecuteScalarAsync(cancellationToken) ?? string.Empty;
        }

        if (attachmentId.Length > 0)
        {
            await using var restoreCommand = connection.CreateCommand();
            restoreCommand.Transaction = transaction;
            restoreCommand.CommandText = """
                UPDATE attachments
                SET deleted_at = NULL,
                    purged_at = NULL,
                    relative_path = $relativePath,
                    updated_at = $updatedAt,
                    sync_state = 'dirty',
                    sync_revision = sync_revision + 1
                WHERE id = $id;
                """;
            restoreCommand.Parameters.AddWithValue("$relativePath", relativePath);
            restoreCommand.Parameters.AddWithValue("$updatedAt", now);
            restoreCommand.Parameters.AddWithValue("$id", attachmentId);
            await restoreCommand.ExecuteNonQueryAsync(cancellationToken);
        }
        else
        {
            attachmentId = Guid.NewGuid().ToString();
            await using var insertCommand = connection.CreateCommand();
            insertCommand.Transaction = transaction;
            insertCommand.CommandText = """
                INSERT INTO attachments (
                    id, note_id, relative_path, cloud_path, mime_type, size,
                    width, height, sha256, created_at, deleted_at, sync_state,
                    updated_at, purged_at, sync_revision)
                VALUES (
                    $id, $noteId, $relativePath, NULL, $mimeType, $size,
                    $width, $height, $sha256, $createdAt, NULL, 'dirty',
                    $updatedAt, NULL, 1);
                """;
            insertCommand.Parameters.AddWithValue("$id", attachmentId);
            insertCommand.Parameters.AddWithValue("$noteId", noteId);
            insertCommand.Parameters.AddWithValue("$relativePath", relativePath);
            insertCommand.Parameters.AddWithValue("$mimeType", image.MimeType);
            insertCommand.Parameters.AddWithValue("$size", content.LongLength);
            insertCommand.Parameters.AddWithValue("$width", image.Width);
            insertCommand.Parameters.AddWithValue("$height", image.Height);
            insertCommand.Parameters.AddWithValue("$sha256", hash);
            insertCommand.Parameters.AddWithValue("$createdAt", now);
            insertCommand.Parameters.AddWithValue("$updatedAt", now);
            await insertCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var outboxCommand = connection.CreateCommand();
        outboxCommand.Transaction = transaction;
        outboxCommand.CommandText = """
            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT $id, 'attachment', id, 'upsert', sync_revision, 0, NULL, NULL
            FROM attachments WHERE id = $entityId
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                operation = 'upsert', local_version = excluded.local_version, attempt_count = 0,
                next_attempt_at = NULL, last_error = NULL;
            """;
        outboxCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
        outboxCommand.Parameters.AddWithValue("$entityId", attachmentId);
        await outboxCommand.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new AttachmentImportResult
        {
            Id = attachmentId,
            RelativePath = relativePath,
            MimeType = image.MimeType,
            Size = content.LongLength,
            Width = image.Width,
            Height = image.Height,
        };
    }

    public async Task ReconcileReferencesAsync(
        string noteId,
        string bodyHtml,
        CancellationToken cancellationToken = default)
    {
        var referencedPaths = ExtractReferencedPaths(bodyHtml);
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.Parameters.AddWithValue("$noteId", noteId);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));

        if (referencedPaths.Count == 0)
        {
            command.CommandText = """
                UPDATE attachments
                SET deleted_at = COALESCE(deleted_at, $now),
                    updated_at = CASE WHEN deleted_at IS NULL THEN $now ELSE updated_at END,
                    purged_at = CASE WHEN deleted_at IS NULL THEN NULL ELSE purged_at END,
                    sync_revision = CASE WHEN deleted_at IS NULL THEN sync_revision + 1 ELSE sync_revision END,
                    sync_state = CASE WHEN deleted_at IS NULL THEN 'dirty' ELSE sync_state END
                WHERE note_id = $noteId;
                """;
        }
        else
        {
            var parameterNames = new List<string>(referencedPaths.Count);
            var index = 0;
            foreach (var referencedPath in referencedPaths)
            {
                var parameterName = $"$path{index++}";
                parameterNames.Add(parameterName);
                command.Parameters.AddWithValue(parameterName, referencedPath);
            }

            command.CommandText = $"""
                UPDATE attachments
                SET deleted_at = CASE
                    WHEN relative_path IN ({string.Join(", ", parameterNames)}) THEN NULL
                    ELSE COALESCE(deleted_at, $now)
                END,
                    purged_at = CASE
                        WHEN relative_path IN ({string.Join(", ", parameterNames)}) THEN NULL
                        ELSE purged_at
                    END,
                    updated_at = CASE
                        WHEN (relative_path IN ({string.Join(", ", parameterNames)}) AND deleted_at IS NOT NULL)
                          OR (relative_path NOT IN ({string.Join(", ", parameterNames)}) AND deleted_at IS NULL)
                        THEN $now ELSE updated_at
                    END,
                    sync_revision = CASE
                        WHEN (relative_path IN ({string.Join(", ", parameterNames)}) AND deleted_at IS NOT NULL)
                          OR (relative_path NOT IN ({string.Join(", ", parameterNames)}) AND deleted_at IS NULL)
                        THEN sync_revision + 1 ELSE sync_revision
                    END,
                    sync_state = CASE
                        WHEN (relative_path IN ({string.Join(", ", parameterNames)}) AND deleted_at IS NOT NULL)
                          OR (relative_path NOT IN ({string.Join(", ", parameterNames)}) AND deleted_at IS NULL)
                        THEN 'dirty' ELSE sync_state
                    END
                WHERE note_id = $noteId;
                """;
        }

        await command.ExecuteNonQueryAsync(cancellationToken);
        await using var outboxCommand = connection.CreateCommand();
        outboxCommand.Transaction = transaction;
        outboxCommand.CommandText = """
            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT lower(hex(randomblob(16))), 'attachment', id, 'upsert', sync_revision, 0, NULL, NULL
            FROM attachments WHERE note_id = $noteId AND updated_at = $now
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                operation = 'upsert', local_version = excluded.local_version, attempt_count = 0,
                next_attempt_at = NULL, last_error = NULL;
            """;
        outboxCommand.Parameters.AddWithValue("$noteId", noteId);
        outboxCommand.Parameters.AddWithValue("$now", command.Parameters["$now"].Value);
        await outboxCommand.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        await PurgeExpiredAsync(cancellationToken);
    }

    public async Task DeleteForNoteAsync(string noteId, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow.ToString("O");
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using (var updateCommand = connection.CreateCommand())
        {
            updateCommand.Transaction = transaction;
            updateCommand.CommandText = """
                UPDATE attachments
                SET deleted_at = COALESCE(deleted_at, $now),
                    updated_at = CASE WHEN deleted_at IS NULL THEN $now ELSE updated_at END,
                    sync_revision = CASE WHEN deleted_at IS NULL THEN sync_revision + 1 ELSE sync_revision END,
                    sync_state = CASE WHEN deleted_at IS NULL THEN 'dirty' ELSE sync_state END
                WHERE note_id = $noteId;
                """;
            updateCommand.Parameters.AddWithValue("$noteId", noteId);
            updateCommand.Parameters.AddWithValue("$now", now);
            await updateCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var outboxCommand = connection.CreateCommand())
        {
            outboxCommand.Transaction = transaction;
            outboxCommand.CommandText = """
                INSERT INTO sync_outbox (
                    id, entity_type, entity_id, operation, local_version,
                    attempt_count, next_attempt_at, last_error)
                SELECT lower(hex(randomblob(16))), 'attachment', id, 'upsert', sync_revision, 0, NULL, NULL
                FROM attachments WHERE note_id = $noteId AND updated_at = $now
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                    operation = 'upsert', local_version = excluded.local_version,
                    attempt_count = 0, next_attempt_at = NULL, last_error = NULL;
                """;
            outboxCommand.Parameters.AddWithValue("$noteId", noteId);
            outboxCommand.Parameters.AddWithValue("$now", now);
            await outboxCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task PurgeExpiredAsync(CancellationToken cancellationToken = default)
    {
        var expired = new List<(string Id, string RelativePath)>();
        await using (var connection = await connectionFactory.OpenAsync(cancellationToken))
        {
            await using (var selectCommand = connection.CreateCommand())
            {
                selectCommand.CommandText = """
                    SELECT id, relative_path
                    FROM attachments
                    WHERE deleted_at IS NOT NULL
                      AND deleted_at <= $cutoff
                      AND purged_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM sync_outbox
                          WHERE entity_type = 'attachment'
                            AND entity_id = attachments.id
                      );
                    """;
                selectCommand.Parameters.AddWithValue(
                    "$cutoff",
                    (DateTimeOffset.UtcNow - GarbageCollectionDelay).ToString("O"));
                await using var reader = await selectCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    expired.Add((reader.GetString(0), reader.GetString(1)));
                }
            }

            await using var transaction = connection.BeginTransaction();
            foreach (var item in expired)
            {
                await using var deleteCommand = connection.CreateCommand();
                deleteCommand.Transaction = transaction;
                deleteCommand.CommandText = "UPDATE attachments SET purged_at = $purgedAt WHERE id = $id;";
                deleteCommand.Parameters.AddWithValue("$id", item.Id);
                deleteCommand.Parameters.AddWithValue("$purgedAt", DateTimeOffset.UtcNow.ToString("O"));
                await deleteCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
        }

        foreach (var relativePath in expired.Select(item => item.RelativePath).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            await DeleteFileIfOrphanedAsync(relativePath, cancellationToken);
        }
    }

    private static HashSet<string> ExtractReferencedPaths(string bodyHtml)
    {
        var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match match in ImageSourcePattern.Matches(bodyHtml))
        {
            if (!Uri.TryCreate(WebUtility.HtmlDecode(match.Groups["url"].Value), UriKind.Absolute, out var uri) ||
                !string.Equals(uri.Host, "lightnote.attachments", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var relativePath = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')).Replace('\\', '/');
            if (relativePath.Length > 0 && !relativePath.Contains("..", StringComparison.Ordinal))
            {
                result.Add(relativePath);
            }
        }

        return result;
    }

    private async Task DeleteFileIfOrphanedAsync(string relativePath, CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM attachments
            WHERE relative_path = $relativePath
              AND (deleted_at IS NULL OR purged_at IS NULL);
            """;
        command.Parameters.AddWithValue("$relativePath", relativePath);
        if (Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken)) > 0)
        {
            return;
        }

        var absolutePath = ResolveAttachmentPath(relativePath);
        await _fileGate.WaitAsync(cancellationToken);
        try
        {
            if (File.Exists(absolutePath))
            {
                File.Delete(absolutePath);
            }
        }
        finally
        {
            _fileGate.Release();
        }
    }

    private async Task EnsureNoteExistsAsync(string noteId, CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM notes WHERE id = $noteId;";
        command.Parameters.AddWithValue("$noteId", noteId);
        if (Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken)) == 0)
        {
            throw new InvalidOperationException("无法为不存在的笔记保存图片。");
        }
    }

    private string ResolveAttachmentPath(string relativePath)
    {
        var root = Path.GetFullPath(paths.AttachmentsDirectory);
        var candidate = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("附件路径超出数据目录。");
        }

        return candidate;
    }

    private static ImageInfo DetectImage(byte[] content, string fileName, string declaredMimeType)
    {
        var data = content.AsSpan();
        if (data.Length >= 24 && data[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
        {
            return new ImageInfo("image/png", "png", ReadBigEndianInt32(data, 16), ReadBigEndianInt32(data, 20));
        }

        if (data.Length >= 10 &&
            (data[..6].SequenceEqual("GIF87a"u8) || data[..6].SequenceEqual("GIF89a"u8)))
        {
            return new ImageInfo("image/gif", "gif", ReadLittleEndianUInt16(data, 6), ReadLittleEndianUInt16(data, 8));
        }

        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return ReadWebP(data);
        }

        if (data.Length >= 4 && data[0] == 0xFF && data[1] == 0xD8)
        {
            return ReadJpeg(data);
        }

        throw new NotSupportedException(
            $"不支持“{fileName}”的图片格式（{declaredMimeType}）。仅支持 PNG、JPEG、WebP 和 GIF。");
    }

    private static ImageInfo ReadJpeg(ReadOnlySpan<byte> data)
    {
        var offset = 2;
        while (offset + 8 < data.Length)
        {
            if (data[offset] != 0xFF)
            {
                offset++;
                continue;
            }

            var marker = data[offset + 1];
            offset += 2;
            if (marker is 0xD8 or 0xD9 || marker is >= 0xD0 and <= 0xD7)
            {
                continue;
            }

            if (offset + 2 > data.Length)
            {
                break;
            }

            var segmentLength = ReadBigEndianUInt16(data, offset);
            if (segmentLength < 2 || offset + segmentLength > data.Length)
            {
                break;
            }

            if (marker is 0xC0 or 0xC1 or 0xC2 or 0xC3 or 0xC5 or 0xC6 or 0xC7 or 0xC9 or 0xCA or 0xCB or 0xCD or 0xCE or 0xCF)
            {
                var height = ReadBigEndianUInt16(data, offset + 3);
                var width = ReadBigEndianUInt16(data, offset + 5);
                return EnsureValid(new ImageInfo("image/jpeg", "jpg", width, height));
            }

            offset += segmentLength;
        }

        throw new InvalidDataException("无法读取 JPEG 图片尺寸。");
    }

    private static ImageInfo ReadWebP(ReadOnlySpan<byte> data)
    {
        if (data.Length >= 30 && data.Slice(12, 4).SequenceEqual("VP8X"u8))
        {
            var width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
            var height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
            return EnsureValid(new ImageInfo("image/webp", "webp", width, height));
        }

        if (data.Length >= 25 && data.Slice(12, 4).SequenceEqual("VP8L"u8) && data[20] == 0x2F)
        {
            var width = 1 + ((data[21] | data[22] << 8) & 0x3FFF);
            var height = 1 + (((data[22] >> 6) | data[23] << 2 | data[24] << 10) & 0x3FFF);
            return EnsureValid(new ImageInfo("image/webp", "webp", width, height));
        }

        if (data.Length >= 30 && data.Slice(12, 4).SequenceEqual("VP8 "u8) &&
            data[23] == 0x9D && data[24] == 0x01 && data[25] == 0x2A)
        {
            var width = ReadLittleEndianUInt16(data, 26) & 0x3FFF;
            var height = ReadLittleEndianUInt16(data, 28) & 0x3FFF;
            return EnsureValid(new ImageInfo("image/webp", "webp", width, height));
        }

        throw new InvalidDataException("无法读取 WebP 图片尺寸。");
    }

    private static ImageInfo EnsureValid(ImageInfo image) =>
        image.Width > 0 && image.Height > 0
            ? image
            : throw new InvalidDataException("图片尺寸无效。");

    private static int ReadBigEndianInt32(ReadOnlySpan<byte> data, int offset) =>
        EnsurePositive((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]);

    private static int ReadBigEndianUInt16(ReadOnlySpan<byte> data, int offset) =>
        (data[offset] << 8) | data[offset + 1];

    private static int ReadLittleEndianUInt16(ReadOnlySpan<byte> data, int offset) =>
        data[offset] | (data[offset + 1] << 8);

    private static int EnsurePositive(int value) =>
        value > 0 ? value : throw new InvalidDataException("图片尺寸无效。");

    private sealed record ImageInfo(string MimeType, string Extension, int Width, int Height);
}

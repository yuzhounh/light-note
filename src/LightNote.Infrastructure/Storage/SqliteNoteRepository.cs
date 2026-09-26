using System.Globalization;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using Microsoft.Data.Sqlite;

namespace LightNote.Infrastructure.Storage;

public sealed class SqliteNoteRepository(SqliteConnectionFactory connectionFactory) : INoteRepository
{
    public async Task<Note?> GetAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {Columns} FROM notes WHERE id = $id AND purged_at IS NULL LIMIT 1;";
        command.Parameters.AddWithValue("$id", id);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadNote(reader) : null;
    }

    public async Task<IReadOnlyList<Note>> ListAsync(
        string? notebookId,
        bool allNotebooks,
        bool deletedOnly,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        var deletionFilter = deletedOnly
            ? "deleted_at IS NOT NULL AND purged_at IS NULL"
            : "deleted_at IS NULL AND purged_at IS NULL";
        var notebookFilter = allNotebooks
            ? string.Empty
            : notebookId is null
                ? "AND notebook_id IS NULL"
                : "AND notebook_id = $notebookId";
        command.CommandText = $"""
            SELECT {Columns}
            FROM notes
            WHERE {deletionFilter}
            {notebookFilter}
            ORDER BY is_pinned DESC, created_at DESC
            LIMIT $limit OFFSET $offset;
            """;
        if (!allNotebooks && notebookId is not null)
        {
            command.Parameters.AddWithValue("$notebookId", notebookId);
        }

        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        command.Parameters.AddWithValue("$offset", Math.Max(0, offset));

        var notes = new List<Note>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            notes.Add(ReadNote(reader));
        }

        return notes;
    }

    public async Task<int> CountAsync(
        string? notebookId,
        bool allNotebooks,
        bool deletedOnly,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        var deletionFilter = deletedOnly
            ? "deleted_at IS NOT NULL AND purged_at IS NULL"
            : "deleted_at IS NULL AND purged_at IS NULL";
        var notebookFilter = allNotebooks
            ? string.Empty
            : notebookId is null
                ? "AND notebook_id IS NULL"
                : "AND notebook_id = $notebookId";
        command.CommandText = $"""
            SELECT COUNT(*)
            FROM notes
            WHERE {deletionFilter}
            {notebookFilter};
            """;
        if (!allNotebooks && notebookId is not null)
        {
            command.Parameters.AddWithValue("$notebookId", notebookId);
        }

        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
    }

    public Task<IReadOnlyList<Note>> ListRecentAsync(
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default) =>
        ListWithFilterAsync(
            "deleted_at IS NULL AND purged_at IS NULL",
            "created_at DESC",
            limit,
            offset,
            cancellationToken);

    public Task<IReadOnlyList<Note>> ListPinnedAsync(
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default) =>
        ListWithFilterAsync(
            "deleted_at IS NULL AND purged_at IS NULL AND is_pinned = 1",
            "created_at DESC",
            limit,
            offset,
            cancellationToken);

    public async Task<IReadOnlyList<Note>> ListByTagAsync(
        string tagId,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT {PrefixedColumns}
            FROM notes AS n
            INNER JOIN note_tags AS nt ON nt.note_id = n.id
            WHERE nt.tag_id = $tagId AND n.deleted_at IS NULL AND n.purged_at IS NULL
            ORDER BY n.is_pinned DESC, n.created_at DESC
            LIMIT $limit OFFSET $offset;
            """;
        command.Parameters.AddWithValue("$tagId", tagId);
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        command.Parameters.AddWithValue("$offset", Math.Max(0, offset));
        return await ReadNotesAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<Note>> ListByNotebookIdsAsync(
        IReadOnlyList<string> notebookIds,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        if (notebookIds.Count == 0)
        {
            return [];
        }

        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        var parameterNames = new string[notebookIds.Count];
        for (var index = 0; index < notebookIds.Count; index++)
        {
            parameterNames[index] = $"$notebook{index}";
            command.Parameters.AddWithValue(parameterNames[index], notebookIds[index]);
        }

        command.CommandText = $"""
            SELECT {Columns}
            FROM notes
            WHERE notebook_id IN ({string.Join(", ", parameterNames)})
              AND deleted_at IS NULL AND purged_at IS NULL
            ORDER BY is_pinned DESC, created_at DESC
            LIMIT $limit OFFSET $offset;
            """;
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        command.Parameters.AddWithValue("$offset", Math.Max(0, offset));
        return await ReadNotesAsync(command, cancellationToken);
    }

    public async Task<int> CountByNotebookIdsAsync(
        IReadOnlyList<string> notebookIds,
        CancellationToken cancellationToken = default)
    {
        if (notebookIds.Count == 0)
        {
            return 0;
        }

        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        var parameterNames = new string[notebookIds.Count];
        for (var index = 0; index < notebookIds.Count; index++)
        {
            parameterNames[index] = $"$notebook{index}";
            command.Parameters.AddWithValue(parameterNames[index], notebookIds[index]);
        }

        command.CommandText = $"""
            SELECT COUNT(*)
            FROM notes
            WHERE notebook_id IN ({string.Join(", ", parameterNames)})
              AND deleted_at IS NULL AND purged_at IS NULL;
            """;
        return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
    }

    public async Task<IReadOnlyList<NoteSearchHit>> SearchAsync(
        string query,
        int limit = 100,
        int offset = 0,
        CancellationToken cancellationToken = default)
    {
        var terms = query
            .Trim()
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (terms.Length == 0)
        {
            return [];
        }

        return terms.Any(term => term.EnumerateRunes().Count() < 3)
            ? await SearchWithLikeAsync(terms, limit, offset, cancellationToken)
            : await SearchWithFtsAsync(terms, limit, offset, cancellationToken);
    }

    public async Task UpsertAsync(Note note, CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        Note? existing = null;
        await using (var existingCommand = connection.CreateCommand())
        {
            existingCommand.Transaction = transaction;
            existingCommand.CommandText = $"SELECT {Columns} FROM notes WHERE id = $id LIMIT 1;";
            existingCommand.Parameters.AddWithValue("$id", note.Id);
            await using var reader = await existingCommand.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                existing = ReadNote(reader);
            }
        }

        if (existing is not null && HasVersionedContentChanged(existing, note))
        {
            await using var versionCommand = connection.CreateCommand();
            versionCommand.Transaction = transaction;
            versionCommand.CommandText = """
                INSERT INTO note_versions (
                    id, note_id, version, body_json, title, created_at,
                    source_device_id, body_html, body_text)
                VALUES (
                    $id, $noteId, $version, $bodyJson, $title, $createdAt,
                    NULL, $bodyHtml, $bodyText)
                ON CONFLICT(note_id, version) DO NOTHING;
                """;
            versionCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
            versionCommand.Parameters.AddWithValue("$noteId", existing.Id);
            versionCommand.Parameters.AddWithValue("$version", existing.Version);
            versionCommand.Parameters.AddWithValue("$bodyJson", existing.BodyJson);
            versionCommand.Parameters.AddWithValue("$title", existing.Title);
            versionCommand.Parameters.AddWithValue("$createdAt", existing.UpdatedAt.ToUniversalTime().ToString("O"));
            versionCommand.Parameters.AddWithValue("$bodyHtml", existing.BodyHtml);
            versionCommand.Parameters.AddWithValue("$bodyText", existing.BodyText);
            await versionCommand.ExecuteNonQueryAsync(cancellationToken);

            await using var trimCommand = connection.CreateCommand();
            trimCommand.Transaction = transaction;
            trimCommand.CommandText = """
                DELETE FROM note_versions
                WHERE note_id = $noteId
                  AND id NOT IN (
                      SELECT id FROM note_versions
                      WHERE note_id = $noteId
                      ORDER BY version DESC
                      LIMIT 20
                  );
                """;
            trimCommand.Parameters.AddWithValue("$noteId", existing.Id);
            await trimCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO notes (
                id, notebook_id, title, body_json, body_html, body_text, is_pinned,
                created_at, updated_at, deleted_at, version, sync_state,
                purged_at, sync_revision)
            VALUES (
                $id, $notebookId, $title, $bodyJson, $bodyHtml, $bodyText, $isPinned,
                $createdAt, $updatedAt, $deletedAt, $version, $syncState,
                NULL, 1)
            ON CONFLICT(id) DO UPDATE SET
                notebook_id = excluded.notebook_id,
                title = excluded.title,
                body_json = excluded.body_json,
                body_html = excluded.body_html,
                body_text = excluded.body_text,
                is_pinned = excluded.is_pinned,
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at,
                version = excluded.version,
                sync_state = excluded.sync_state,
                purged_at = NULL,
                sync_revision = notes.sync_revision + 1;
            """;

        AddParameters(command, note);
        await command.ExecuteNonQueryAsync(cancellationToken);

        await using var outboxCommand = connection.CreateCommand();
        outboxCommand.Transaction = transaction;
        outboxCommand.CommandText = """
            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT $id, 'note', id, 'upsert', sync_revision, 0, NULL, NULL
            FROM notes WHERE id = $entityId
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                operation = 'upsert',
                local_version = excluded.local_version,
                attempt_count = 0,
                next_attempt_at = NULL,
                last_error = NULL;
            """;
        outboxCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
        outboxCommand.Parameters.AddWithValue("$entityId", note.Id);
        await outboxCommand.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task DeletePermanentlyAsync(string id, CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        var now = DateTimeOffset.UtcNow.ToString("O");
        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                DELETE FROM note_tags WHERE note_id = $id;
                DELETE FROM note_versions WHERE note_id = $id;
                UPDATE notes
                SET notebook_id = NULL,
                    title = '已永久删除的笔记',
                    body_json = '{"type":"doc","content":[{"type":"paragraph"}]}',
                    body_html = '<p></p>',
                    body_text = '',
                    is_pinned = 0,
                    updated_at = $now,
                    deleted_at = COALESCE(deleted_at, $now),
                    purged_at = $now,
                    version = version + 1,
                    sync_state = 'dirty',
                    sync_revision = sync_revision + 1
                WHERE id = $id;
                """;
            command.Parameters.AddWithValue("$id", id);
            command.Parameters.AddWithValue("$now", now);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var outboxCommand = connection.CreateCommand())
        {
            outboxCommand.Transaction = transaction;
            outboxCommand.CommandText = """
                INSERT INTO sync_outbox (
                    id, entity_type, entity_id, operation, local_version,
                    attempt_count, next_attempt_at, last_error)
                SELECT $outboxId, 'note', id, 'upsert', sync_revision, 0, NULL, NULL
                FROM notes WHERE id = $id
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                    operation = 'upsert', local_version = excluded.local_version,
                    attempt_count = 0, next_attempt_at = NULL, last_error = NULL;
                """;
            outboxCommand.Parameters.AddWithValue("$outboxId", Guid.NewGuid().ToString());
            outboxCommand.Parameters.AddWithValue("$id", id);
            await outboxCommand.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
    }

    private const string Columns = """
        id, notebook_id, title, body_json, body_html, body_text, is_pinned,
        created_at, updated_at, deleted_at, version, sync_state
        """;

    private const string PrefixedColumns = """
        n.id, n.notebook_id, n.title, n.body_json, n.body_html, n.body_text, n.is_pinned,
        n.created_at, n.updated_at, n.deleted_at, n.version, n.sync_state
        """;

    private async Task<IReadOnlyList<Note>> ListWithFilterAsync(
        string filter,
        string orderBy,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT {Columns}
            FROM notes
            WHERE {filter}
            ORDER BY {orderBy}
            LIMIT $limit OFFSET $offset;
            """;
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        command.Parameters.AddWithValue("$offset", Math.Max(0, offset));
        return await ReadNotesAsync(command, cancellationToken);
    }

    private async Task<IReadOnlyList<NoteSearchHit>> SearchWithFtsAsync(
        IReadOnlyList<string> terms,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT {PrefixedColumns},
                   snippet(notes_fts, 2, '', '', ' … ', 24)
            FROM notes_fts
            INNER JOIN notes AS n ON n.id = notes_fts.note_id
            WHERE notes_fts MATCH $query AND n.deleted_at IS NULL AND n.purged_at IS NULL
            ORDER BY n.is_pinned DESC, bm25(notes_fts, 8.0, 1.0), n.updated_at DESC
            LIMIT $limit OFFSET $offset;
            """;
        command.Parameters.AddWithValue(
            "$query",
            string.Join(" AND ", terms.Select(term => $"\"{term.Replace("\"", "\"\"")}\"")));
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        command.Parameters.AddWithValue("$offset", Math.Max(0, offset));
        return await ReadSearchHitsAsync(command, terms, cancellationToken);
    }

    private async Task<IReadOnlyList<NoteSearchHit>> SearchWithLikeAsync(
        IReadOnlyList<string> terms,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        var filters = new List<string>(terms.Count);
        for (var index = 0; index < terms.Count; index++)
        {
            var parameterName = $"$term{index}";
            filters.Add($"(n.title LIKE {parameterName} ESCAPE '\\' OR n.body_text LIKE {parameterName} ESCAPE '\\')");
            command.Parameters.AddWithValue(parameterName, $"%{EscapeLike(terms[index])}%");
        }

        command.CommandText = $"""
            SELECT {PrefixedColumns}, n.body_text
            FROM notes AS n
            WHERE n.deleted_at IS NULL AND n.purged_at IS NULL AND {string.Join(" AND ", filters)}
            ORDER BY n.is_pinned DESC, n.updated_at DESC
            LIMIT $limit OFFSET $offset;
            """;
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        command.Parameters.AddWithValue("$offset", Math.Max(0, offset));
        return await ReadSearchHitsAsync(command, terms, cancellationToken);
    }

    private static async Task<IReadOnlyList<Note>> ReadNotesAsync(
        SqliteCommand command,
        CancellationToken cancellationToken)
    {
        var notes = new List<Note>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            notes.Add(ReadNote(reader));
        }

        return notes;
    }

    private static async Task<IReadOnlyList<NoteSearchHit>> ReadSearchHitsAsync(
        SqliteCommand command,
        IReadOnlyList<string> terms,
        CancellationToken cancellationToken)
    {
        var hits = new List<NoteSearchHit>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var note = ReadNote(reader);
            var candidate = reader.IsDBNull(12) ? note.BodyText : reader.GetString(12);
            hits.Add(new NoteSearchHit
            {
                Note = note,
                Snippet = CreateSnippet(candidate, terms),
            });
        }

        return hits;
    }

    private static string CreateSnippet(string bodyText, IReadOnlyList<string> terms)
    {
        var text = bodyText;
        var match = System.Text.RegularExpressions.Regex.Match(text, @"^\s*\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*");
        if (match.Success)
        {
            var contentAfterTimestamp = text[match.Length..].Trim();
            if (!string.IsNullOrWhiteSpace(contentAfterTimestamp))
            {
                text = contentAfterTimestamp;
            }
        }

        var normalized = text.ReplaceLineEndings(" ").Trim();
        if (normalized.Length == 0)
        {
            return "空笔记";
        }

        var matchIndex = terms
            .Select(term => normalized.IndexOf(term, StringComparison.CurrentCultureIgnoreCase))
            .Where(index => index >= 0)
            .DefaultIfEmpty(0)
            .Min();
        var start = Math.Max(0, matchIndex - 35);
        var length = Math.Min(110, normalized.Length - start);
        return $"{(start > 0 ? "…" : string.Empty)}{normalized.Substring(start, length)}{(start + length < normalized.Length ? "…" : string.Empty)}";
    }

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("%", "\\%", StringComparison.Ordinal)
            .Replace("_", "\\_", StringComparison.Ordinal);

    private static bool HasVersionedContentChanged(Note existing, Note updated) =>
        existing.Title != updated.Title ||
        existing.BodyJson != updated.BodyJson ||
        existing.BodyHtml != updated.BodyHtml ||
        existing.BodyText != updated.BodyText;

    private static void AddParameters(SqliteCommand command, Note note)
    {
        command.Parameters.AddWithValue("$id", note.Id);
        command.Parameters.AddWithValue("$notebookId", (object?)note.NotebookId ?? DBNull.Value);
        command.Parameters.AddWithValue("$title", note.Title);
        command.Parameters.AddWithValue("$bodyJson", note.BodyJson);
        command.Parameters.AddWithValue("$bodyHtml", note.BodyHtml);
        command.Parameters.AddWithValue("$bodyText", note.BodyText);
        command.Parameters.AddWithValue("$isPinned", note.IsPinned ? 1 : 0);
        command.Parameters.AddWithValue("$createdAt", note.CreatedAt.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue("$updatedAt", note.UpdatedAt.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue(
            "$deletedAt",
            note.DeletedAt is null ? DBNull.Value : note.DeletedAt.Value.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue("$version", note.Version);
        command.Parameters.AddWithValue("$syncState", note.SyncState.ToString().ToLowerInvariant());
    }

    private static Note ReadNote(SqliteDataReader reader)
    {
        return new Note
        {
            Id = reader.GetString(0),
            NotebookId = reader.IsDBNull(1) ? null : reader.GetString(1),
            Title = reader.GetString(2),
            BodyJson = reader.GetString(3),
            BodyHtml = reader.GetString(4),
            BodyText = reader.GetString(5),
            IsPinned = reader.GetInt64(6) == 1,
            CreatedAt = ParseUtc(reader.GetString(7)),
            UpdatedAt = ParseUtc(reader.GetString(8)),
            DeletedAt = reader.IsDBNull(9) ? null : ParseUtc(reader.GetString(9)),
            Version = reader.GetInt64(10),
            SyncState = Enum.Parse<SyncState>(reader.GetString(11), ignoreCase: true),
        };
    }

    private static DateTimeOffset ParseUtc(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}

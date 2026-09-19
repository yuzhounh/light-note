using System.Globalization;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.Infrastructure.Storage;

public sealed class SqliteTagRepository(SqliteConnectionFactory connectionFactory) : ITagRepository
{
    public async Task<IReadOnlyList<Tag>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT t.id, t.name, t.created_at
            FROM tags AS t
            WHERE EXISTS (SELECT 1 FROM note_tags AS nt WHERE nt.tag_id = t.id)
            ORDER BY t.name COLLATE NOCASE;
            """;
        return await ReadTagsAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<Tag>> ListForNoteAsync(
        string noteId,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT t.id, t.name, t.created_at
            FROM tags AS t
            INNER JOIN note_tags AS nt ON nt.tag_id = t.id
            WHERE nt.note_id = $noteId
            ORDER BY t.name COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("$noteId", noteId);
        return await ReadTagsAsync(command, cancellationToken);
    }

    public async Task SetForNoteAsync(
        string noteId,
        IReadOnlyCollection<string> tagNames,
        CancellationToken cancellationToken = default)
    {
        var normalizedNames = tagNames
            .Select(name => name.Trim().TrimStart('#'))
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.CurrentCultureIgnoreCase)
            .Take(20)
            .Select(name => name.Length <= 40 ? name : name[..40])
            .ToArray();

        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using (var deleteCommand = connection.CreateCommand())
        {
            deleteCommand.Transaction = transaction;
            deleteCommand.CommandText = "DELETE FROM note_tags WHERE note_id = $noteId;";
            deleteCommand.Parameters.AddWithValue("$noteId", noteId);
            await deleteCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        var now = DateTimeOffset.UtcNow.ToString("O");
        foreach (var tagName in normalizedNames)
        {
            await using (var tagCommand = connection.CreateCommand())
            {
                tagCommand.Transaction = transaction;
                tagCommand.CommandText = """
                    INSERT INTO tags (id, name, created_at)
                    VALUES ($id, $name, $createdAt)
                    ON CONFLICT(name) DO NOTHING;
                    """;
                tagCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
                tagCommand.Parameters.AddWithValue("$name", tagName);
                tagCommand.Parameters.AddWithValue("$createdAt", now);
                await tagCommand.ExecuteNonQueryAsync(cancellationToken);
            }

            await using var linkCommand = connection.CreateCommand();
            linkCommand.Transaction = transaction;
            linkCommand.CommandText = """
                INSERT INTO note_tags (note_id, tag_id, created_at)
                SELECT $noteId, id, $createdAt
                FROM tags
                WHERE name = $name COLLATE NOCASE;
                """;
            linkCommand.Parameters.AddWithValue("$noteId", noteId);
            linkCommand.Parameters.AddWithValue("$name", tagName);
            linkCommand.Parameters.AddWithValue("$createdAt", now);
            await linkCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var cleanupCommand = connection.CreateCommand())
        {
            cleanupCommand.Transaction = transaction;
            cleanupCommand.CommandText = """
                DELETE FROM tags
                WHERE NOT EXISTS (SELECT 1 FROM note_tags WHERE note_tags.tag_id = tags.id);
                """;
            await cleanupCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var outboxCommand = connection.CreateCommand())
        {
            outboxCommand.Transaction = transaction;
            outboxCommand.CommandText = """
                UPDATE notes
                SET updated_at = $updatedAt,
                    sync_state = 'dirty',
                    sync_revision = sync_revision + 1
                WHERE id = $noteId;

                INSERT INTO sync_outbox (
                    id, entity_type, entity_id, operation, local_version,
                    attempt_count, next_attempt_at, last_error)
                SELECT $id, 'note', id, 'upsert', sync_revision, 0, NULL, NULL
                FROM notes WHERE id = $noteId
                ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                    operation = 'upsert',
                    local_version = excluded.local_version,
                    attempt_count = 0,
                    next_attempt_at = NULL,
                    last_error = NULL;
                """;
            outboxCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
            outboxCommand.Parameters.AddWithValue("$noteId", noteId);
            outboxCommand.Parameters.AddWithValue("$updatedAt", now);
            await outboxCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task<IReadOnlyList<Tag>> ReadTagsAsync(
        Microsoft.Data.Sqlite.SqliteCommand command,
        CancellationToken cancellationToken)
    {
        var tags = new List<Tag>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            tags.Add(new Tag
            {
                Id = reader.GetString(0),
                Name = reader.GetString(1),
                CreatedAt = DateTimeOffset.Parse(
                    reader.GetString(2),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind),
            });
        }

        return tags;
    }
}

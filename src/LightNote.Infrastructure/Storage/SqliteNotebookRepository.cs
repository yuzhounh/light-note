using System.Globalization;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.Infrastructure.Storage;

public sealed class SqliteNotebookRepository(SqliteConnectionFactory connectionFactory) : INotebookRepository
{
    public async Task<IReadOnlyList<Notebook>> ListAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, sort_order, created_at, updated_at, deleted_at
            FROM notebooks
            WHERE deleted_at IS NULL
            ORDER BY sort_order, name COLLATE NOCASE;
            """;

        var notebooks = new List<Notebook>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            notebooks.Add(new Notebook
            {
                Id = reader.GetString(0),
                Name = reader.GetString(1),
                SortOrder = reader.GetInt32(2),
                CreatedAt = ParseUtc(reader.GetString(3)),
                UpdatedAt = ParseUtc(reader.GetString(4)),
                DeletedAt = reader.IsDBNull(5) ? null : ParseUtc(reader.GetString(5)),
            });
        }

        return notebooks;
    }

    public async Task UpsertAsync(Notebook notebook, CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO notebooks (
                id, name, sort_order, created_at, updated_at, deleted_at, sync_revision)
            VALUES ($id, $name, $sortOrder, $createdAt, $updatedAt, $deletedAt, 1)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at,
                sync_revision = notebooks.sync_revision + 1;
            """;
        command.Parameters.AddWithValue("$id", notebook.Id);
        command.Parameters.AddWithValue("$name", notebook.Name);
        command.Parameters.AddWithValue("$sortOrder", notebook.SortOrder);
        command.Parameters.AddWithValue("$createdAt", notebook.CreatedAt.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue("$updatedAt", notebook.UpdatedAt.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue(
            "$deletedAt",
            notebook.DeletedAt is null
                ? DBNull.Value
                : notebook.DeletedAt.Value.ToUniversalTime().ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);

        await using var outboxCommand = connection.CreateCommand();
        outboxCommand.Transaction = transaction;
        outboxCommand.CommandText = """
            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT $id, 'notebook', id, 'upsert', sync_revision, 0, NULL, NULL
            FROM notebooks WHERE id = $entityId
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                operation = 'upsert', local_version = excluded.local_version, attempt_count = 0,
                next_attempt_at = NULL, last_error = NULL;
            """;
        outboxCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
        outboxCommand.Parameters.AddWithValue("$entityId", notebook.Id);
        await outboxCommand.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private static DateTimeOffset ParseUtc(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}

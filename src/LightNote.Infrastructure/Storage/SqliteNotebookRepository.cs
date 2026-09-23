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

    public async Task<IReadOnlyList<NotebookGroup>> ListGroupsAsync(
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, sort_order, created_at, updated_at
            FROM notebook_groups
            ORDER BY sort_order, name COLLATE NOCASE;
            """;

        var groups = new List<NotebookGroup>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            groups.Add(new NotebookGroup
            {
                Id = reader.GetString(0),
                Name = reader.GetString(1),
                SortOrder = reader.GetInt32(2),
                CreatedAt = ParseUtc(reader.GetString(3)),
                UpdatedAt = ParseUtc(reader.GetString(4)),
            });
        }

        return groups;
    }

    public async Task<IReadOnlyDictionary<string, string>> ListGroupAssignmentsAsync(
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT notebook_id, group_id FROM notebook_group_memberships;";

        var assignments = new Dictionary<string, string>(StringComparer.Ordinal);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            assignments[reader.GetString(0)] = reader.GetString(1);
        }

        return assignments;
    }

    public async Task UpsertGroupAsync(
        NotebookGroup group,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO notebook_groups (id, name, sort_order, created_at, updated_at)
            VALUES ($id, $name, $sortOrder, $createdAt, $updatedAt)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$id", group.Id);
        command.Parameters.AddWithValue("$name", group.Name);
        command.Parameters.AddWithValue("$sortOrder", group.SortOrder);
        command.Parameters.AddWithValue("$createdAt", group.CreatedAt.ToUniversalTime().ToString("O"));
        command.Parameters.AddWithValue("$updatedAt", group.UpdatedAt.ToUniversalTime().ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteGroupAsync(string groupId, CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            DELETE FROM notebook_group_memberships WHERE group_id = $groupId;
            DELETE FROM notebook_groups WHERE id = $groupId;
            """;
        command.Parameters.AddWithValue("$groupId", groupId);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task AssignToGroupAsync(
        string notebookId,
        string? groupId,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        if (groupId is null)
        {
            command.CommandText = "DELETE FROM notebook_group_memberships WHERE notebook_id = $notebookId;";
        }
        else
        {
            command.CommandText = """
                INSERT INTO notebook_group_memberships (notebook_id, group_id, created_at)
                VALUES ($notebookId, $groupId, $createdAt)
                ON CONFLICT(notebook_id) DO UPDATE SET
                    group_id = excluded.group_id,
                    created_at = excluded.created_at;
                """;
            command.Parameters.AddWithValue("$groupId", groupId);
            command.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
        }
        command.Parameters.AddWithValue("$notebookId", notebookId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static DateTimeOffset ParseUtc(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}

using System.Globalization;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using Microsoft.Data.Sqlite;

namespace LightNote.Infrastructure.Storage;

public sealed class SqliteNoteHistoryRepository(
    SqliteConnectionFactory connectionFactory) : INoteHistoryRepository
{
    public async Task<IReadOnlyList<NoteVersion>> ListAsync(
        string noteId,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT {Columns}
            FROM note_versions
            WHERE note_id = $noteId
            ORDER BY version DESC
            LIMIT 20;
            """;
        command.Parameters.AddWithValue("$noteId", noteId);

        var versions = new List<NoteVersion>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            versions.Add(ReadVersion(reader));
        }

        return versions;
    }

    public async Task<NoteVersion?> GetAsync(
        string versionId,
        CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {Columns} FROM note_versions WHERE id = $id LIMIT 1;";
        command.Parameters.AddWithValue("$id", versionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadVersion(reader) : null;
    }

    private const string Columns = """
        id, note_id, version, title, body_json, body_html, body_text, created_at, is_conflict
        """;

    private static NoteVersion ReadVersion(SqliteDataReader reader) => new()
    {
        Id = reader.GetString(0),
        NoteId = reader.GetString(1),
        Version = reader.GetInt64(2),
        Title = reader.GetString(3),
        BodyJson = reader.GetString(4),
        BodyHtml = reader.GetString(5),
        BodyText = reader.GetString(6),
        CreatedAt = DateTimeOffset.Parse(
            reader.GetString(7),
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind),
        IsConflict = reader.GetInt64(8) == 1,
    };
}

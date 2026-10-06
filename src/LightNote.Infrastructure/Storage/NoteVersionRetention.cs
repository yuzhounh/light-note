using Microsoft.Data.Sqlite;

namespace LightNote.Infrastructure.Storage;

/// <summary>
/// 历史版本的保留策略：
/// 48 小时以内的版本全部保留；更早的版本每天只保留最后一个；
/// 普通版本最多 50 个，同步冲突副本单独最多 20 个。
/// </summary>
internal static class NoteVersionRetention
{
    public const int MaxVersions = 50;
    public const int MaxConflictVersions = 20;
    public static readonly TimeSpan DailyThinningAge = TimeSpan.FromHours(48);

    public static async Task TrimAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string noteId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            DELETE FROM note_versions
            WHERE note_id = $noteId
              AND is_conflict = 0
              AND julianday(created_at) < julianday($cutoff)
              AND id NOT IN (
                  SELECT v.id FROM note_versions v
                  WHERE v.note_id = $noteId
                    AND v.is_conflict = 0
                    AND julianday(v.created_at) < julianday($cutoff)
                    AND julianday(v.created_at) = (
                        SELECT MAX(julianday(w.created_at)) FROM note_versions w
                        WHERE w.note_id = $noteId
                          AND w.is_conflict = 0
                          AND julianday(w.created_at) < julianday($cutoff)
                          AND date(w.created_at) = date(v.created_at)));

            DELETE FROM note_versions
            WHERE note_id = $noteId
              AND is_conflict = 0
              AND id NOT IN (
                  SELECT id FROM note_versions
                  WHERE note_id = $noteId AND is_conflict = 0
                  ORDER BY julianday(created_at) DESC, version DESC
                  LIMIT $maxVersions);

            DELETE FROM note_versions
            WHERE note_id = $noteId
              AND is_conflict = 1
              AND id NOT IN (
                  SELECT id FROM note_versions
                  WHERE note_id = $noteId AND is_conflict = 1
                  ORDER BY julianday(created_at) DESC, version DESC
                  LIMIT $maxConflicts);
            """;
        command.Parameters.AddWithValue("$noteId", noteId);
        command.Parameters.AddWithValue("$cutoff", (DateTimeOffset.UtcNow - DailyThinningAge).ToString("O"));
        command.Parameters.AddWithValue("$maxVersions", MaxVersions);
        command.Parameters.AddWithValue("$maxConflicts", MaxConflictVersions);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}

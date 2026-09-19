using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class AttachmentServiceTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task ImportDeduplicatesFilesAndKeepsReferencesPerNote()
    {
        var (paths, connectionFactory, notes, service) = await CreateServicesAsync();
        var firstNote = await CreateNoteAsync(notes, "First");
        var secondNote = await CreateNoteAsync(notes, "Second");
        var imageBytes = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

        var first = await service.ImportAsync(firstNote.Id, "capture.png", "image/png", imageBytes);
        var repeated = await service.ImportAsync(firstNote.Id, "capture-copy.png", "image/png", imageBytes);
        var shared = await service.ImportAsync(secondNote.Id, "shared.png", "image/png", imageBytes);

        Assert.Equal(first.Id, repeated.Id);
        Assert.NotEqual(first.Id, shared.Id);
        Assert.Equal(first.RelativePath, shared.RelativePath);
        Assert.Equal("image/png", first.MimeType);
        Assert.Equal(1, first.Width);
        Assert.Equal(1, first.Height);
        Assert.True(File.Exists(Path.Combine(paths.AttachmentsDirectory, first.RelativePath.Replace('/', Path.DirectorySeparatorChar))));

        await service.ReconcileReferencesAsync(firstNote.Id, string.Empty);
        await using (var connection = await connectionFactory.OpenAsync())
        {
            await using var ageCommand = connection.CreateCommand();
            ageCommand.CommandText = "UPDATE attachments SET deleted_at = $deletedAt WHERE note_id = $noteId;";
            ageCommand.Parameters.AddWithValue("$deletedAt", DateTimeOffset.UtcNow.AddDays(-2).ToString("O"));
            ageCommand.Parameters.AddWithValue("$noteId", firstNote.Id);
            await ageCommand.ExecuteNonQueryAsync();
        }

        await service.PurgeExpiredAsync();
        Assert.Equal(1, await CountAttachmentsAsync(connectionFactory, firstNote.Id));
        Assert.Equal(1, await CountAttachmentsAsync(connectionFactory, secondNote.Id));
        Assert.True(File.Exists(Path.Combine(paths.AttachmentsDirectory, first.RelativePath.Replace('/', Path.DirectorySeparatorChar))));

        await using (var connection = await connectionFactory.OpenAsync())
        {
            await using var acknowledgeCommand = connection.CreateCommand();
            acknowledgeCommand.CommandText = """
                DELETE FROM sync_outbox
                WHERE entity_type = 'attachment'
                  AND entity_id IN (SELECT id FROM attachments WHERE note_id = $noteId);
                """;
            acknowledgeCommand.Parameters.AddWithValue("$noteId", firstNote.Id);
            await acknowledgeCommand.ExecuteNonQueryAsync();
        }
        await service.PurgeExpiredAsync();
        Assert.Equal(1, await CountPurgedAttachmentsAsync(connectionFactory, firstNote.Id));

        await service.DeleteForNoteAsync(secondNote.Id);
        await using (var connection = await connectionFactory.OpenAsync())
        {
            await using var acknowledgeCommand = connection.CreateCommand();
            acknowledgeCommand.CommandText = """
                UPDATE attachments SET deleted_at = $deletedAt WHERE note_id = $noteId;
                DELETE FROM sync_outbox
                WHERE entity_type = 'attachment'
                  AND entity_id IN (SELECT id FROM attachments WHERE note_id = $noteId);
                """;
            acknowledgeCommand.Parameters.AddWithValue("$deletedAt", DateTimeOffset.UtcNow.AddDays(-2).ToString("O"));
            acknowledgeCommand.Parameters.AddWithValue("$noteId", secondNote.Id);
            await acknowledgeCommand.ExecuteNonQueryAsync();
        }
        await service.PurgeExpiredAsync();
        Assert.False(File.Exists(Path.Combine(paths.AttachmentsDirectory, first.RelativePath.Replace('/', Path.DirectorySeparatorChar))));
    }

    [Fact]
    public async Task ImportRejectsUnsupportedContentWithoutWritingAFile()
    {
        var (paths, _, notes, service) = await CreateServicesAsync();
        var note = await CreateNoteAsync(notes, "Unsupported");

        var exception = await Assert.ThrowsAsync<NotSupportedException>(() =>
            service.ImportAsync(note.Id, "document.txt", "text/plain", "not an image"u8.ToArray()));

        Assert.Contains("仅支持 PNG、JPEG、WebP 和 GIF", exception.Message);
        Assert.Empty(Directory.EnumerateFiles(paths.AttachmentsDirectory, "*", SearchOption.AllDirectories));
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
    }

    private async Task<(AppDataPaths Paths, SqliteConnectionFactory ConnectionFactory, INoteRepository Notes, AttachmentService Service)>
        CreateServicesAsync()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var initializer = new SqliteDatabaseInitializer(connectionFactory, new NullLogger());
        await initializer.InitializeAsync();
        return (paths, connectionFactory, new SqliteNoteRepository(connectionFactory), new AttachmentService(paths, connectionFactory));
    }

    private static async Task<Note> CreateNoteAsync(INoteRepository notes, string title)
    {
        var now = DateTimeOffset.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid().ToString(),
            Title = title,
            BodyJson = "{\"type\":\"doc\"}",
            BodyHtml = $"<p>{title}</p>",
            BodyText = title,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await notes.UpsertAsync(note);
        return note;
    }

    private static async Task<long> CountAttachmentsAsync(
        SqliteConnectionFactory connectionFactory,
        string noteId)
    {
        await using var connection = await connectionFactory.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM attachments WHERE note_id = $noteId;";
        command.Parameters.AddWithValue("$noteId", noteId);
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    private static async Task<long> CountPurgedAttachmentsAsync(
        SqliteConnectionFactory connectionFactory,
        string noteId)
    {
        await using var connection = await connectionFactory.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM attachments
            WHERE note_id = $noteId AND purged_at IS NOT NULL;
            """;
        command.Parameters.AddWithValue("$noteId", noteId);
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    private sealed class NullLogger : IAppLogger
    {
        public void Info(string message)
        {
        }

        public void Error(string message, Exception exception)
        {
        }
    }
}

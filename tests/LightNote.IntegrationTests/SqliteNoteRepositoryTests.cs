using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class SqliteNoteRepositoryTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task MigrationIsRepeatableAndNoteRoundTrips()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var initializer = new SqliteDatabaseInitializer(connectionFactory, new NullLogger());
        var repository = new SqliteNoteRepository(connectionFactory);

        await initializer.InitializeAsync();
        await initializer.InitializeAsync();

        var now = DateTimeOffset.UtcNow;
        var expected = new Note
        {
            Id = Guid.NewGuid().ToString(),
            Title = "SQLite round trip",
            BodyJson = "{\"type\":\"doc\"}",
            BodyHtml = "<p>Round trip</p>",
            BodyText = "Round trip",
            IsPinned = true,
            CreatedAt = now,
            UpdatedAt = now,
            Version = 3,
            SyncState = SyncState.Dirty,
        };

        await repository.UpsertAsync(expected);
        var actual = await repository.GetAsync(expected.Id);

        Assert.NotNull(actual);
        Assert.Equal(expected.Id, actual.Id);
        Assert.Equal(expected.Title, actual.Title);
        Assert.Equal(expected.BodyJson, actual.BodyJson);
        Assert.Equal(expected.BodyHtml, actual.BodyHtml);
        Assert.Equal(expected.BodyText, actual.BodyText);
        Assert.True(actual.IsPinned);
        Assert.Equal(expected.Version, actual.Version);
        Assert.Equal(expected.SyncState, actual.SyncState);
    }

    [Fact]
    public async Task NotebookFiltersTrashAndPermanentDeleteWorkTogether()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var initializer = new SqliteDatabaseInitializer(connectionFactory, new NullLogger());
        var noteRepository = new SqliteNoteRepository(connectionFactory);
        var notebookRepository = new SqliteNotebookRepository(connectionFactory);
        await initializer.InitializeAsync();

        var now = DateTimeOffset.UtcNow;
        var notebook = new Notebook
        {
            Id = Guid.NewGuid().ToString(),
            Name = "Work",
            SortOrder = 0,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await notebookRepository.UpsertAsync(notebook);

        var notebookNote = CreateNote("Notebook note", notebook.Id, now);
        var unfiledNote = CreateNote("Unfiled note", null, now.AddMinutes(1));
        var deletedNote = CreateNote("Deleted note", notebook.Id, now.AddMinutes(2)) with
        {
            DeletedAt = now.AddMinutes(3),
        };
        await noteRepository.UpsertAsync(notebookNote);
        await noteRepository.UpsertAsync(unfiledNote);
        await noteRepository.UpsertAsync(deletedNote);

        var storedNotebooks = await notebookRepository.ListAsync();
        var notebookNotes = await noteRepository.ListAsync(notebook.Id, allNotebooks: false, deletedOnly: false);
        var unfiledNotes = await noteRepository.ListAsync(null, allNotebooks: false, deletedOnly: false);
        var activeNotes = await noteRepository.ListAsync(null, allNotebooks: true, deletedOnly: false);
        var trash = await noteRepository.ListAsync(null, allNotebooks: true, deletedOnly: true);

        Assert.Single(storedNotebooks);
        Assert.Equal(notebook.Id, storedNotebooks[0].Id);
        Assert.Single(notebookNotes);
        Assert.Equal(notebookNote.Id, notebookNotes[0].Id);
        Assert.Single(unfiledNotes);
        Assert.Equal(unfiledNote.Id, unfiledNotes[0].Id);
        Assert.Equal(2, activeNotes.Count);
        Assert.Single(trash);
        Assert.Equal(deletedNote.Id, trash[0].Id);

        await noteRepository.DeletePermanentlyAsync(deletedNote.Id);
        Assert.Null(await noteRepository.GetAsync(deletedNote.Id));
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
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

    private static Note CreateNote(string title, string? notebookId, DateTimeOffset now) => new()
    {
        Id = Guid.NewGuid().ToString(),
        NotebookId = notebookId,
        Title = title,
        BodyJson = "{\"type\":\"doc\"}",
        BodyHtml = $"<p>{title}</p>",
        BodyText = title,
        CreatedAt = now,
        UpdatedAt = now,
    };
}

using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class MainViewModelSaveTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task PendingChangesStayBoundToTheirOriginalNoteDuringRapidSwitching()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var logger = new NullLogger();
        var initializer = new SqliteDatabaseInitializer(connectionFactory, logger);
        var notes = new SqliteNoteRepository(connectionFactory);
        var notebooks = new SqliteNotebookRepository(connectionFactory);
        await initializer.InitializeAsync();

        var now = DateTimeOffset.UtcNow;
        var first = CreateNote("First", now);
        var second = CreateNote("Second", now.AddSeconds(1));
        await notes.UpsertAsync(first);
        await notes.UpsertAsync(second);

        var viewModel = new MainViewModel(notes, notebooks, logger);
        await viewModel.InitializeAsync();
        viewModel.ApplyEditorChange(first.Id, "{\"note\":1}", "<p>First edited</p>", "First edited");
        viewModel.SelectedNote = viewModel.Notes.Single(item => item.Model.Id == second.Id);
        viewModel.ApplyEditorChange(second.Id, "{\"note\":2}", "<p>Second edited</p>", "Second edited");

        Assert.True(viewModel.HasUnsavedChanges);
        Assert.True(await viewModel.FlushAllAsync());

        var storedFirst = await notes.GetAsync(first.Id);
        var storedSecond = await notes.GetAsync(second.Id);
        Assert.Equal("First edited", storedFirst?.BodyText);
        Assert.Equal("Second edited", storedSecond?.BodyText);
        Assert.Equal("{\"note\":1}", storedFirst?.BodyJson);
        Assert.Equal("{\"note\":2}", storedSecond?.BodyJson);
        Assert.False(viewModel.HasUnsavedChanges);
    }

    [Fact]
    public async Task EditorChangeIsSavedAutomaticallyAfterDebounce()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var logger = new NullLogger();
        var initializer = new SqliteDatabaseInitializer(connectionFactory, logger);
        var notes = new SqliteNoteRepository(connectionFactory);
        var notebooks = new SqliteNotebookRepository(connectionFactory);
        await initializer.InitializeAsync();

        var note = CreateNote("Automatic", DateTimeOffset.UtcNow);
        await notes.UpsertAsync(note);
        var viewModel = new MainViewModel(notes, notebooks, logger);
        await viewModel.InitializeAsync();

        viewModel.ApplyEditorChange(
            note.Id,
            "{\"auto\":true}",
            "<p>Automatically saved</p>",
            "Automatically saved");

        for (var attempt = 0; attempt < 30 && viewModel.HasUnsavedChanges; attempt++)
        {
            await Task.Delay(100);
        }

        var stored = await notes.GetAsync(note.Id);
        Assert.False(viewModel.HasUnsavedChanges);
        Assert.Equal("Automatically saved", stored?.BodyText);
        Assert.StartsWith("已保存", viewModel.EditorStatus);
    }

    [Fact]
    public async Task NewNoteCreatesCleanBlankNote()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var logger = new NullLogger();
        var initializer = new SqliteDatabaseInitializer(connectionFactory, logger);
        var notes = new SqliteNoteRepository(connectionFactory);
        var notebooks = new SqliteNotebookRepository(connectionFactory);
        await initializer.InitializeAsync();

        var viewModel = new MainViewModel(notes, notebooks, logger);
        await viewModel.InitializeAsync();

        await viewModel.NewNoteCommand.ExecuteAsync(null);

        Assert.NotNull(viewModel.SelectedNote);
        var created = viewModel.SelectedNote.Model;
        Assert.Equal("<p></p>", created.BodyHtml);
        Assert.Equal(string.Empty, created.BodyText);
    }

    [Fact]
    public async Task TitleEndingWithPeriodIsPreserved()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var logger = new NullLogger();
        var initializer = new SqliteDatabaseInitializer(connectionFactory, logger);
        var notes = new SqliteNoteRepository(connectionFactory);
        var notebooks = new SqliteNotebookRepository(connectionFactory);
        await initializer.InitializeAsync();

        var viewModel = new MainViewModel(notes, notebooks, logger);
        await viewModel.InitializeAsync();
        await viewModel.NewNoteCommand.ExecuteAsync(null);

        viewModel.EditableTitle = "新计划。";
        Assert.True(await viewModel.FlushAllAsync());

        var saved = await notes.GetAsync(viewModel.SelectedNote!.Model.Id);
        Assert.Equal("新计划。", saved?.Title);
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
    }

    private static Note CreateNote(string title, DateTimeOffset now) => new()
    {
        Id = Guid.NewGuid().ToString(),
        Title = title,
        BodyJson = "{\"type\":\"doc\"}",
        BodyHtml = $"<p>{title}</p>",
        BodyText = title,
        CreatedAt = now,
        UpdatedAt = now,
    };

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

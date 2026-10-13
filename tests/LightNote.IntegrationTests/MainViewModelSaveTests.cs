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

    [Theory]
    [InlineData("75%")]
    [InlineData("50%")]
    [InlineData("327px")]
    public async Task ImageWidthAndEditedTextSurviveSavingAndReopening(string width)
    {
        var paths = new AppDataPaths(_testDirectory);
        var connections = new SqliteConnectionFactory(paths);
        var logger = new NullLogger();
        await new SqliteDatabaseInitializer(connections, logger).InitializeAsync();
        var notes = new SqliteNoteRepository(connections);
        var notebooks = new SqliteNotebookRepository(connections);
        var note = CreateNote("含图片的笔记", DateTimeOffset.UtcNow);
        await notes.UpsertAsync(note);
        var viewModel = new MainViewModel(notes, notebooks, logger);
        await viewModel.InitializeAsync();
        var html = $"<p>2026-10-11 22:40:12</p><p>新增文字</p><img src=\"https://lightnote.attachments/test.png\" width=\"{width}\" style=\"width: {width}\">";
        var json = System.Text.Json.JsonSerializer.Serialize(new
        {
            type = "doc",
            content = new object[]
            {
                new { type = "paragraph", content = new[] { new { type = "text", text = "2026-10-11 22:40:12" } } },
                new { type = "paragraph", content = new[] { new { type = "text", text = "新增文字" } } },
                new { type = "image", attrs = new { src = "https://lightnote.attachments/test.png", width } },
            },
        });
        viewModel.ApplyEditorChange(note.Id, json, html, "2026-10-11 22:40:12\n新增文字");
        Assert.True(await viewModel.FlushAllAsync());

        var reopened = new MainViewModel(notes, notebooks, logger);
        await reopened.InitializeAsync();
        var stored = reopened.Notes.Single(item => item.Model.Id == note.Id).Model;
        Assert.Equal(html, stored.BodyHtml);
        Assert.Equal(json, stored.BodyJson);
        Assert.Equal("2026-10-11 22:40:12\n新增文字", stored.BodyText);
    }

    [Fact]
    public async Task ReloadingTheListKeepsPendingBodyTitleAndImageWidth()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connections = new SqliteConnectionFactory(paths);
        var logger = new NullLogger();
        await new SqliteDatabaseInitializer(connections, logger).InitializeAsync();
        var notes = new SqliteNoteRepository(connections);
        var notebooks = new SqliteNotebookRepository(connections);
        var note = CreateNote("原始标题", DateTimeOffset.UtcNow);
        await notes.UpsertAsync(note);
        var viewModel = new MainViewModel(notes, notebooks, logger);
        await viewModel.InitializeAsync();
        const string html = "<p>刚刚输入的正文</p><img src=\"https://lightnote.attachments/test.png\" width=\"50%\">";
        viewModel.ApplyEditorChange(note.Id, "{\"newDraft\":true}", html, "刚刚输入的正文");
        viewModel.ApplyNoteTitleChange(note.Id, "刚刚修改的标题");
        await viewModel.UpdateNavigationAsync(showRecent: true, showTrash: true);

        var shown = viewModel.Notes.Single(item => item.Model.Id == note.Id).Model;
        Assert.Equal(html, shown.BodyHtml);
        Assert.Equal("刚刚修改的标题", shown.Title);
        Assert.True(await viewModel.FlushAllAsync());
        Assert.Equal(html, (await notes.GetAsync(note.Id))?.BodyHtml);
    }

    [Fact]
    public async Task OlderSaveCompletionCannotReplaceEditsTypedWhileSaving()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connections = new SqliteConnectionFactory(paths);
        var logger = new NullLogger();
        await new SqliteDatabaseInitializer(connections, logger).InitializeAsync();
        var notes = new SqliteNoteRepository(connections);
        var note = CreateNote("正在编辑", DateTimeOffset.UtcNow);
        await notes.UpsertAsync(note);
        var repository = System.Reflection.DispatchProxy.Create<INoteRepository, BlockingSaveProxy>();
        var proxy = (BlockingSaveProxy)repository;
        proxy.Inner = notes;
        var viewModel = new MainViewModel(repository, new SqliteNotebookRepository(connections), logger);
        await viewModel.InitializeAsync();
        viewModel.ApplyEditorChange(note.Id, "{\"edit\":1}", "<p>第一版</p>", "第一版");
        proxy.BlockNextSave = true;
        var saving = viewModel.FlushAllAsync();
        await proxy.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        viewModel.ApplyEditorChange(note.Id, "{\"edit\":2}", "<p>第二版</p>", "第二版");
        proxy.Release.SetResult();
        await saving;

        Assert.Equal("第二版", viewModel.Notes.Single(item => item.Model.Id == note.Id).Model.BodyText);
        Assert.True(await viewModel.FlushAllAsync());
        Assert.Equal("第二版", (await notes.GetAsync(note.Id))?.BodyText);
    }

    public class BlockingSaveProxy : System.Reflection.DispatchProxy
    {
        public INoteRepository Inner { get; set; } = null!;
        public bool BlockNextSave { get; set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        protected override object? Invoke(System.Reflection.MethodInfo? method, object?[]? args)
        {
            if (method!.Name == nameof(INoteRepository.UpsertAsync) && BlockNextSave)
            {
                BlockNextSave = false;
                return BlockedSaveAsync(method, args);
            }
            return method.Invoke(Inner, args);
        }

        private async Task BlockedSaveAsync(System.Reflection.MethodInfo method, object?[]? args)
        {
            Started.SetResult();
            await Release.Task;
            await (Task)method.Invoke(Inner, args)!;
        }
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

using System.Diagnostics;
using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class SearchAndOrganizationTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SearchHandlesChineseEnglishNumbersAndIndexUpdates()
    {
        var (_, notes, _, _) = await CreateServicesAsync();
        var alpha = CreateNote("Project Alpha 2026", "混合关键字 release42", DateTimeOffset.UtcNow);
        var chinese = CreateNote("中文计划", "这是本地优先笔记", DateTimeOffset.UtcNow.AddMinutes(1));
        var deleted = CreateNote("Archived project", "release42 2026", DateTimeOffset.UtcNow.AddMinutes(2)) with
        {
            DeletedAt = DateTimeOffset.UtcNow,
        };
        await notes.UpsertAsync(alpha);
        await notes.UpsertAsync(chinese);
        await notes.UpsertAsync(deleted);

        var englishHits = await notes.SearchAsync("project");
        var chineseHits = await notes.SearchAsync("本地");
        var mixedHits = await notes.SearchAsync("release42 2026");

        Assert.Single(englishHits);
        Assert.Equal(alpha.Id, englishHits[0].Note.Id);
        Assert.Single(chineseHits);
        Assert.Equal(chinese.Id, chineseHits[0].Note.Id);
        Assert.Single(mixedHits);
        Assert.Equal(alpha.Id, mixedHits[0].Note.Id);

        await notes.UpsertAsync(alpha with
        {
            Title = "Renamed note",
            BodyText = "索引已经更新",
            BodyHtml = "<p>索引已经更新</p>",
            Version = alpha.Version + 1,
            UpdatedAt = DateTimeOffset.UtcNow.AddMinutes(3),
        });

        Assert.Empty(await notes.SearchAsync("release42"));
        Assert.Single(await notes.SearchAsync("索引"));
    }

    [Fact]
    public async Task TagsPinnedRecentAndNotebookMoveWorkTogether()
    {
        var (_, notes, notebooks, tags) = await CreateServicesAsync();
        var now = DateTimeOffset.UtcNow;
        var notebook = new Notebook
        {
            Id = Guid.NewGuid().ToString(),
            Name = "Work",
            SortOrder = 0,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await notebooks.UpsertAsync(notebook);
        var olderPinned = CreateNote("Pinned", "important", now) with { IsPinned = true };
        var newer = CreateNote("Newer", "daily", now.AddMinutes(1));
        await notes.UpsertAsync(olderPinned);
        await notes.UpsertAsync(newer);

        await tags.SetForNoteAsync(olderPinned.Id, ["Work", "Important", "work"]);
        var storedTags = await tags.ListForNoteAsync(olderPinned.Id);
        var allTags = await tags.ListAsync();
        var taggedNotes = await notes.ListByTagAsync(storedTags.Single(tag => tag.Name == "Work").Id);
        var recent = await notes.ListRecentAsync();
        var pinned = await notes.ListPinnedAsync();

        Assert.Equal(2, storedTags.Count);
        Assert.Equal(2, allTags.Count);
        Assert.Single(taggedNotes);
        Assert.Equal(olderPinned.Id, taggedNotes[0].Id);
        Assert.Equal(newer.Id, recent[0].Id);
        Assert.Single(pinned);
        Assert.Equal(olderPinned.Id, pinned[0].Id);

        var viewModel = new MainViewModel(notes, notebooks, new NullLogger(), tagRepository: tags);
        await viewModel.InitializeAsync();
        viewModel.SelectedNote = viewModel.Notes.Single(item => item.Model.Id == newer.Id);
        await viewModel.MoveSelectedNoteAsync(notebook.Id);

        Assert.Equal(notebook.Id, (await notes.GetAsync(newer.Id))?.NotebookId);
    }

    [Fact]
    public async Task ViewModelDebouncesRapidSearchInput()
    {
        var (_, notes, notebooks, tags) = await CreateServicesAsync();
        var expected = CreateNote("中文记录", "本地搜索立即可用", DateTimeOffset.UtcNow);
        await notes.UpsertAsync(expected);
        await notes.UpsertAsync(CreateNote("Other", "unrelated text", DateTimeOffset.UtcNow.AddMinutes(1)));
        var viewModel = new MainViewModel(notes, notebooks, new NullLogger(), tagRepository: tags);
        await viewModel.InitializeAsync();

        viewModel.SearchQuery = "missing";
        viewModel.SearchQuery = "本地";
        for (var attempt = 0; attempt < 40 && viewModel.EditorStatus == "正在搜索…"; attempt++)
        {
            await Task.Delay(50);
        }

        Assert.Single(viewModel.Notes);
        Assert.Equal(expected.Id, viewModel.Notes[0].Model.Id);
        Assert.Equal("本地", viewModel.Notes[0].MatchQuery);
    }

    [Fact]
    public async Task SearchStaysResponsiveWithFiveThousandNotes()
    {
        var (connectionFactory, notes, _, _) = await CreateServicesAsync();
        await using (var connection = await connectionFactory.OpenAsync())
        await using (var transaction = connection.BeginTransaction())
        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO notes (
                    id, notebook_id, title, body_json, body_html, body_text, is_pinned,
                    created_at, updated_at, deleted_at, version, sync_state)
                VALUES (
                    $id, NULL, $title, '{}', $html, $text, 0,
                    $createdAt, $updatedAt, NULL, 1, 'dirty');
                """;
            var idParameter = command.Parameters.Add("$id", Microsoft.Data.Sqlite.SqliteType.Text);
            var titleParameter = command.Parameters.Add("$title", Microsoft.Data.Sqlite.SqliteType.Text);
            var htmlParameter = command.Parameters.Add("$html", Microsoft.Data.Sqlite.SqliteType.Text);
            var textParameter = command.Parameters.Add("$text", Microsoft.Data.Sqlite.SqliteType.Text);
            var createdParameter = command.Parameters.Add("$createdAt", Microsoft.Data.Sqlite.SqliteType.Text);
            var updatedParameter = command.Parameters.Add("$updatedAt", Microsoft.Data.Sqlite.SqliteType.Text);
            var timestamp = DateTimeOffset.UtcNow.ToString("O");
            for (var index = 0; index < 5_000; index++)
            {
                var body = index == 4_321
                    ? "unique needle-quantum-2026 mixed keyword"
                    : $"ordinary local note number {index}";
                idParameter.Value = Guid.NewGuid().ToString();
                titleParameter.Value = $"Performance note {index}";
                htmlParameter.Value = $"<p>{body}</p>";
                textParameter.Value = body;
                createdParameter.Value = timestamp;
                updatedParameter.Value = timestamp;
                await command.ExecuteNonQueryAsync();
            }

            await transaction.CommitAsync();
        }

        var stopwatch = Stopwatch.StartNew();
        var hits = await notes.SearchAsync("needle-quantum-2026");
        stopwatch.Stop();

        Assert.Single(hits);
        Assert.True(
            stopwatch.Elapsed < TimeSpan.FromSeconds(2),
            $"Search took {stopwatch.Elapsed.TotalMilliseconds:F0} ms.");
    }

    [Fact]
    public async Task ViewModelLoadsAllNotesAcrossPages()
    {
        var (_, notes, notebooks, tags) = await CreateServicesAsync();
        var start = DateTimeOffset.UtcNow.AddDays(-1);
        for (var index = 0; index < 125; index++)
        {
            await notes.UpsertAsync(CreateNote(
                $"Paged note {index}",
                $"body {index}",
                start.AddSeconds(index)));
        }

        var viewModel = new MainViewModel(
            notes,
            notebooks,
            new NullLogger(),
            tagRepository: tags);
        await viewModel.InitializeAsync();

        Assert.Equal(50, viewModel.Notes.Count);
        Assert.True(viewModel.HasMoreNotes);
        await viewModel.LoadMoreCommand.ExecuteAsync(null);
        Assert.Equal(100, viewModel.Notes.Count);
        Assert.True(viewModel.HasMoreNotes);
        await viewModel.LoadMoreCommand.ExecuteAsync(null);
        Assert.Equal(125, viewModel.Notes.Count);
        Assert.False(viewModel.HasMoreNotes);
        Assert.Equal(125, viewModel.Notes.Select(item => item.Model.Id).Distinct().Count());
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
    }

    private async Task<(
        SqliteConnectionFactory ConnectionFactory,
        INoteRepository Notes,
        INotebookRepository Notebooks,
        ITagRepository Tags)> CreateServicesAsync()
    {
        var paths = new AppDataPaths(_testDirectory);
        var connectionFactory = new SqliteConnectionFactory(paths);
        var initializer = new SqliteDatabaseInitializer(connectionFactory, new NullLogger());
        await initializer.InitializeAsync();
        await initializer.InitializeAsync();
        return (
            connectionFactory,
            new SqliteNoteRepository(connectionFactory),
            new SqliteNotebookRepository(connectionFactory),
            new SqliteTagRepository(connectionFactory));
    }

    private static Note CreateNote(string title, string body, DateTimeOffset timestamp) => new()
    {
        Id = Guid.NewGuid().ToString(),
        Title = title,
        BodyJson = "{\"type\":\"doc\"}",
        BodyHtml = $"<p>{body}</p>",
        BodyText = body,
        CreatedAt = timestamp,
        UpdatedAt = timestamp,
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

using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class SidebarExpansionTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "LightNote.Tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SidebarSectionsKeepIndependentStateAcrossRefreshAndSettingsReload()
    {
        var (paths, notes, notebooks, tags) = await CreateStoreAsync();
        var note = MakeNote("one");
        await notes.UpsertAsync(note);
        await tags.SetForNoteAsync(note.Id, ["计划"]);
        var view = new MainViewModel(notes, notebooks, new NullLogger(), tagRepository: tags);
        await view.InitializeAsync();
        var group = view.Notebooks.Single(n => n.Kind == NotebookKind.Group);
        var notebook = view.Notebooks.Single(n => n.Id == "notebook");
        var tag = view.Notebooks.Single(n => n.Kind == NotebookKind.Tag);
        Assert.False(notebook.IsVisible);
        Assert.False(tag.IsVisible);

        view.ToggleSidebarExpansion(group);
        view.ToggleSidebarExpansion(view.Notebooks.Single(n => n.Kind == NotebookKind.TagRoot));
        Assert.True(notebook.IsVisible);
        Assert.True(tag.IsVisible);
        await view.RefreshAfterSyncAsync();
        Assert.True(view.Notebooks.Single(n => n.Id == "notebook").IsVisible);
        Assert.True(view.Notebooks.Single(n => n.Kind == NotebookKind.Tag).IsVisible);

        var settingsService = new AppSettingsService(paths);
        settingsService.Save(new AppSettings
        {
            NotebookSectionExpanded = false,
            TagSectionExpanded = view.TagSectionExpanded,
            ExpandedNotebookGroupIds = view.ExpandedNotebookGroupIds,
        });
        var saved = settingsService.Load();
        var restored = new MainViewModel(notes, notebooks, new NullLogger(), tagRepository: tags);
        restored.ConfigureSidebarExpansion(saved.TagSectionExpanded, saved.ExpandedNotebookGroupIds);
        await restored.InitializeAsync();
        Assert.DoesNotContain(restored.Notebooks, n => n.Name == "笔记本组");
        Assert.True(restored.Notebooks.Single(n => n.Kind == NotebookKind.Tag).IsVisible);
        Assert.True(restored.Notebooks.Single(n => n.Id == "notebook").IsVisible);
        Assert.True(restored.Notebooks.Single(n => n.Kind == NotebookKind.Group).IsExpanded);
        restored.ToggleSidebarExpansion(restored.Notebooks.Single(n => n.Kind == NotebookKind.Group));
        Assert.False(restored.Notebooks.Single(n => n.Id == "notebook").IsVisible);
        Assert.True(restored.Notebooks.Single(n => n.Kind == NotebookKind.Group).IsVisible);
        Assert.True(restored.Notebooks.Single(n => n.Kind == NotebookKind.Tag).IsVisible);
    }

    [Fact]
    public async Task TagResultsShowTheirNotebookEvenWhenEveryPageHasOnlyOneNotebook()
    {
        var (_, notes, notebooks, tags) = await CreateStoreAsync();
        for (var i = 0; i < 51; i++)
        {
            var note = MakeNote($"note-{i}");
            await notes.UpsertAsync(note);
            await tags.SetForNoteAsync(note.Id, ["计划"]);
        }
        var view = new MainViewModel(notes, notebooks, new NullLogger(), tagRepository: tags);
        await view.InitializeAsync();
        view.SelectedNotebook = view.Notebooks.Single(n => n.Kind == NotebookKind.Tag);
        await view.RefreshAfterSyncAsync();
        Assert.Equal(50, view.Notes.Count);
        Assert.All(view.Notes, n => { Assert.True(n.ShowNotebookBadge); Assert.Equal("来源笔记本", n.NotebookName); });
        await view.LoadMoreCommand.ExecuteAsync(null);
        Assert.Equal(51, view.Notes.Count);
        Assert.All(view.Notes, n => { Assert.True(n.ShowNotebookBadge); Assert.Equal("来源笔记本", n.NotebookName); });
    }

    private async Task<(AppDataPaths, SqliteNoteRepository, SqliteNotebookRepository, SqliteTagRepository)> CreateStoreAsync()
    {
        var paths = new AppDataPaths(_directory);
        var connections = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(connections, new NullLogger()).InitializeAsync();
        var notebooks = new SqliteNotebookRepository(connections);
        var now = DateTimeOffset.UtcNow;
        await notebooks.UpsertAsync(new Notebook { Id = "notebook", Name = "来源笔记本", CreatedAt = now, UpdatedAt = now });
        await notebooks.UpsertGroupAsync(new NotebookGroup { Id = "group", Name = "归档", CreatedAt = now, UpdatedAt = now });
        await notebooks.AssignToGroupAsync("notebook", "group");
        return (paths, new SqliteNoteRepository(connections), notebooks, new SqliteTagRepository(connections));
    }

    private static Note MakeNote(string title) => new()
    {
        Id = Guid.NewGuid().ToString(), NotebookId = "notebook", Title = title,
        BodyJson = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
        BodyHtml = "<p></p>", BodyText = "", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
    };

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }

    private sealed class NullLogger : IAppLogger
    {
        public void Info(string message) { }
        public void Error(string message, Exception exception) { }
    }
}

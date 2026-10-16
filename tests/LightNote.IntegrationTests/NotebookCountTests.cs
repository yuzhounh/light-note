using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class NotebookCountTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "LightNote.Tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SidebarCountsCoverAllPagesAndRefreshAfterCreateMoveDeleteRestoreAndSync()
    {
        var factory = new SqliteConnectionFactory(new AppDataPaths(_directory));
        var logger = new NullLogger();
        await new SqliteDatabaseInitializer(factory, logger).InitializeAsync();
        var notebooks = new SqliteNotebookRepository(factory);
        var notes = new SqliteNoteRepository(factory);
        var now = DateTimeOffset.UtcNow;
        foreach (var id in new[] { "a", "b" })
            await notebooks.UpsertAsync(new Notebook { Id = id, Name = id, CreatedAt = now, UpdatedAt = now });
        await notebooks.UpsertGroupAsync(new NotebookGroup { Id = "group", Name = "Work", CreatedAt = now, UpdatedAt = now });
        await notebooks.AssignToGroupAsync("a", "group");
        for (var i = 0; i < 63; i++)
            await notes.UpsertAsync(new Note
            {
                Id = $"note-{i}", NotebookId = "a", Title = "Research",
                BodyJson = "{}", BodyHtml = "<p></p>", BodyText = "",
                CreatedAt = now, UpdatedAt = now, DeletedAt = i >= 61 ? now : null,
            });
        await notes.DeletePermanentlyAsync("note-62");

        var vm = new MainViewModel(notes, notebooks, logger);
        vm.ConfigureNavigation(showRecent: false, showTrash: true);
        await vm.InitializeAsync();
        NotebookListItem Item(string id) => vm.Notebooks.Single(item => item.Kind == NotebookKind.User && item.Id == id);
        Assert.Equal(61, Item("a").NoteCount);
        Assert.Equal(0, Item("b").NoteCount);
        Assert.Equal("group", Item("a").GroupId);
        Assert.All(vm.Notebooks.Where(item => item.Kind != NotebookKind.User), item => Assert.False(item.ShowNoteCount));

        await vm.CreateNoteInNotebookAsync("a");
        var createdId = vm.SelectedNote!.Model.Id;
        Assert.Equal(62, Item("a").NoteCount);
        var changes = new List<string?>();
        Item("b").PropertyChanged += (_, args) => changes.Add(args.PropertyName);
        await vm.MoveNoteAsync(createdId, "b");
        Assert.Equal(61, Item("a").NoteCount);
        Assert.Equal(1, Item("b").NoteCount);
        Assert.Contains(nameof(NotebookListItem.NoteCount), changes);
        await vm.DeleteNotesAsync([createdId]);
        Assert.Equal(0, Item("b").NoteCount);
        vm.SelectedNotebook = vm.Notebooks.Single(item => item.Kind == NotebookKind.Trash);
        await vm.RestoreNotesAsync([createdId]);
        Assert.Equal(1, Item("b").NoteCount);

        vm.SelectedNotebook = Item("a");
        vm.SearchQuery = "no matching research";
        await Task.Delay(350);
        Assert.Empty(vm.Notes);
        Assert.Equal(61, Item("a").NoteCount);
        Assert.Equal(1, Item("b").NoteCount);
        var restored = (await notes.GetAsync(createdId))!;
        await notes.UpsertAsync(restored with { NotebookId = "a" });
        await vm.RefreshAfterSyncAsync();
        Assert.Equal(62, Item("a").NoteCount);
        Assert.Equal(0, Item("b").NoteCount);
        await vm.FlushAllAsync();
    }

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

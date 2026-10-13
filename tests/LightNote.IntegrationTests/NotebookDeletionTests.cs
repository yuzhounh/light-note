using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class NotebookDeletionTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "LightNote.Tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task DeletingNotebookPreservesAllPagesAndTrashAndQueuesMatchingSyncRevisions()
    {
        var (factory, notebooks, notes) = await CreateServicesAsync();
        var now = DateTimeOffset.UtcNow;
        await notebooks.UpsertAsync(NewNotebook("target", now));
        await notebooks.UpsertAsync(NewNotebook("other", now));
        await notebooks.UpsertGroupAsync(new NotebookGroup { Id = "group", Name = "组", CreatedAt = now, UpdatedAt = now });
        await notebooks.AssignToGroupAsync("target", "group");
        var originals = Enumerable.Range(0, 61).Select(index => NewNote($"note-{index}", "target", now) with
        {
            DeletedAt = index == 60 ? now.AddDays(-1) : null,
            IsPinned = index == 0,
        }).ToArray();
        foreach (var note in originals)
        {
            await notes.UpsertAsync(note);
        }
        var unaffected = NewNote("unaffected", "other", now);
        await notes.UpsertAsync(unaffected);
        var tags = new SqliteTagRepository(factory);
        await tags.SetForNoteAsync(originals[0].Id, ["保留标签"]);

        await notebooks.DeleteKeepingNotesAsync("target");

        Assert.DoesNotContain(await notebooks.ListAsync(), item => item.Id == "target");
        Assert.Single(await notebooks.ListGroupsAsync());
        Assert.Empty(await notebooks.ListGroupAssignmentsAsync());
        Assert.Equal(60, await notes.CountAsync(null, allNotebooks: false, deletedOnly: false));
        Assert.Equal(1, await notes.CountAsync(null, allNotebooks: false, deletedOnly: true));
        foreach (var original in originals)
        {
            var saved = Assert.IsType<Note>(await notes.GetAsync(original.Id));
            Assert.Null(saved.NotebookId);
            Assert.Equal(original.Title, saved.Title);
            Assert.Equal(original.BodyJson, saved.BodyJson);
            Assert.Equal(original.BodyHtml, saved.BodyHtml);
            Assert.Equal(original.BodyText, saved.BodyText);
            Assert.Equal(original.DeletedAt, saved.DeletedAt);
            Assert.Equal(original.IsPinned, saved.IsPinned);
            Assert.Equal(original.CreatedAt, saved.CreatedAt);
            Assert.Equal(original.Version + 1, saved.Version);
            Assert.Equal(SyncState.Dirty, saved.SyncState);
        }
        Assert.Equal(unaffected, await notes.GetAsync(unaffected.Id));
        Assert.Single(await tags.ListForNoteAsync(originals[0].Id));
        await using var connection = await factory.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT COUNT(*) FROM sync_outbox o
            JOIN notes n ON o.entity_type = 'note' AND o.entity_id = n.id
            WHERE n.id LIKE 'note-%' AND o.local_version = n.sync_revision AND o.operation = 'upsert';
            """;
        Assert.Equal(61L, await command.ExecuteScalarAsync());
        command.CommandText = """
            SELECT COUNT(*) FROM notebooks n JOIN sync_outbox o
            ON o.entity_type = 'notebook' AND o.entity_id = n.id
            WHERE n.id = 'target' AND n.deleted_at IS NOT NULL AND o.local_version = n.sync_revision;
            """;
        Assert.Equal(1L, await command.ExecuteScalarAsync());
        await notebooks.DeleteKeepingNotesAsync("target");
        Assert.Equal(2, (await notes.GetAsync(originals[1].Id))!.Version);
    }

    [Fact]
    public async Task FailedDeletionRollsBackNotesMembershipAndSyncQueue()
    {
        var (factory, notebooks, notes) = await CreateServicesAsync();
        var now = DateTimeOffset.UtcNow;
        await notebooks.UpsertAsync(NewNotebook("target", now));
        await notebooks.UpsertGroupAsync(new NotebookGroup { Id = "group", Name = "组", CreatedAt = now, UpdatedAt = now });
        await notebooks.AssignToGroupAsync("target", "group");
        var original = NewNote("note", "target", now);
        await notes.UpsertAsync(original);
        await using var connection = await factory.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TRIGGER reject_notebook_delete BEFORE UPDATE OF deleted_at ON notebooks
            BEGIN SELECT RAISE(ABORT, 'test failure'); END;
            """;
        await command.ExecuteNonQueryAsync();

        await Assert.ThrowsAsync<Microsoft.Data.Sqlite.SqliteException>(() => notebooks.DeleteKeepingNotesAsync("target"));

        Assert.Equal(original, await notes.GetAsync(original.Id));
        Assert.Single(await notebooks.ListAsync());
        Assert.Equal("group", (await notebooks.ListGroupAssignmentsAsync())["target"]);
        command.CommandText = "SELECT local_version FROM sync_outbox WHERE entity_type = 'note' AND entity_id = 'note';";
        Assert.Equal(1L, await command.ExecuteScalarAsync());
    }

    [Theory]
    [InlineData(true, NotebookKind.Unfiled)]
    [InlineData(false, NotebookKind.All)]
    public async Task ViewModelSavesPendingContentAndDoesNotRestoreDeletedNotebookWhenEditingAgain(
        bool showUnfiled, NotebookKind expectedView)
    {
        var (_, notebooks, notes) = await CreateServicesAsync();
        var vm = new MainViewModel(notes, notebooks, new NullLogger());
        vm.ConfigureNavigation(false, true, showUnfiled);
        await vm.InitializeAsync();
        await vm.CreateNotebookAsync("待删除");
        var notebookId = vm.SelectedNotebook!.Id!;
        await vm.NewNoteCommand.ExecuteAsync(null);
        var noteId = vm.SelectedNote!.Model.Id;
        vm.ApplyEditorChange(noteId, "{}", "<p>尚未保存的内容</p>", "尚未保存的内容");

        await vm.DeleteNotebookAsync(notebookId);

        Assert.Equal(expectedView, vm.SelectedNotebook!.Kind);
        Assert.Equal(noteId, vm.SelectedNote!.Model.Id);
        Assert.Equal("尚未保存的内容", (await notes.GetAsync(noteId))!.BodyText);
        vm.ApplyNoteTitleChange(noteId, "继续编辑");
        Assert.True(await vm.FlushAllAsync());
        var saved = (await notes.GetAsync(noteId))!;
        Assert.Null(saved.NotebookId);
        Assert.Equal("继续编辑", saved.Title);
    }

    [Fact]
    public async Task ContextualCreationRenameAndGroupDeletionPreserveNotebookAndNotes()
    {
        var (_, notebooks, notes) = await CreateServicesAsync();
        var vm = new MainViewModel(notes, notebooks, new NullLogger());
        await vm.InitializeAsync();
        await vm.CreateNotebookGroupAsync("工作");
        var groupId = vm.SelectedNotebook!.Id!;
        await vm.CreateNotebookAsync("项目", groupId: groupId);
        var notebookId = vm.SelectedNotebook!.Id!;
        Assert.Equal(groupId, (await notebooks.ListGroupAssignmentsAsync())[notebookId]);
        await vm.CreateNotebookAsync("其他");
        var viewingId = vm.SelectedNotebook!.Id;
        await vm.RenameNotebookAsync(notebookId, "项目新名");
        Assert.Equal(viewingId, vm.SelectedNotebook!.Id);
        await Assert.ThrowsAsync<InvalidOperationException>(() => vm.RenameNotebookAsync(notebookId, "其他"));

        await vm.CreateNoteInNotebookAsync(notebookId);
        var noteId = vm.SelectedNote!.Model.Id;
        Assert.Equal(notebookId, (await notes.GetAsync(noteId))!.NotebookId);
        await vm.DeleteNotebookGroupAsync(groupId);
        Assert.Contains(await notebooks.ListAsync(), item => item.Id == notebookId && item.Name == "项目新名");
        Assert.Equal(notebookId, (await notes.GetAsync(noteId))!.NotebookId);
        Assert.Empty(await notebooks.ListGroupAssignmentsAsync());
    }

    private async Task<(SqliteConnectionFactory, INotebookRepository, INoteRepository)> CreateServicesAsync()
    {
        var factory = new SqliteConnectionFactory(new AppDataPaths(_directory));
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        return (factory, new SqliteNotebookRepository(factory), new SqliteNoteRepository(factory));
    }

    private static Notebook NewNotebook(string id, DateTimeOffset now) => new()
    {
        Id = id, Name = id, CreatedAt = now, UpdatedAt = now,
    };

    private static Note NewNote(string id, string notebookId, DateTimeOffset now) => new()
    {
        Id = id, NotebookId = notebookId, Title = id, BodyJson = "{}", BodyHtml = "<p>内容</p>",
        BodyText = "内容", CreatedAt = now, UpdatedAt = now,
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

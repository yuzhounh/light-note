using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class NotebookGroupTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task GroupAssignmentCanBeCreatedMovedAndRemovedWithoutDeletingNotebook()
    {
        var paths = new AppDataPaths(_testDirectory);
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        INotebookRepository repository = new SqliteNotebookRepository(factory);
        var now = DateTimeOffset.UtcNow;
        var notebook = new Notebook
        {
            Id = "notebook-a",
            Name = "项目笔记",
            CreatedAt = now,
            UpdatedAt = now,
        };
        var group = new NotebookGroup
        {
            Id = "group-a",
            Name = "工作",
            CreatedAt = now,
            UpdatedAt = now,
        };

        await repository.UpsertAsync(notebook);
        await repository.UpsertGroupAsync(group);
        await repository.AssignToGroupAsync(notebook.Id, group.Id);

        Assert.Equal(group.Id, (await repository.ListGroupAssignmentsAsync())[notebook.Id]);

        await repository.DeleteGroupAsync(group.Id);

        Assert.Empty(await repository.ListGroupsAsync());
        Assert.Empty(await repository.ListGroupAssignmentsAsync());
        Assert.Contains(await repository.ListAsync(), item => item.Id == notebook.Id);
    }

    [Fact]
    public async Task ReorderingNotebooksAndGroupsViaViewModelUpdatesOrder()
    {
        var paths = new AppDataPaths(_testDirectory);
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        INotebookRepository notebookRepo = new SqliteNotebookRepository(factory);
        INoteRepository noteRepo = new SqliteNoteRepository(factory);
        var vm = new LightNote.App.MainViewModel(noteRepo, notebookRepo, new NullLogger());
        await vm.InitializeAsync();

        // Create groups
        await vm.CreateNotebookGroupAsync("工作组");
        await vm.CreateNotebookGroupAsync("生活组");

        var groups = await notebookRepo.ListGroupsAsync();
        Assert.Equal(2, groups.Count);
        var g1 = groups[0].Id;
        var g2 = groups[1].Id;

        // Reorder groups: move g2 before g1
        await vm.ReorderNotebookGroupsAsync(g2, g1, insertAfter: false);
        var reorderedGroups = await notebookRepo.ListGroupsAsync();
        Assert.Equal(g2, reorderedGroups[0].Id);
        Assert.Equal(g1, reorderedGroups[1].Id);

        // Create notebooks
        await vm.CreateNotebookAsync("笔记本1");
        await vm.CreateNotebookAsync("笔记本2");
        await vm.CreateNotebookAsync("笔记本3");

        var nbs = await notebookRepo.ListAsync();
        var n1 = nbs.First(n => n.Name == "笔记本1").Id;
        var n2 = nbs.First(n => n.Name == "笔记本2").Id;
        var n3 = nbs.First(n => n.Name == "笔记本3").Id;

        // Assign n1 and n2 to g2
        await vm.AssignNotebookToGroupAsync(n1, g2);
        await vm.AssignNotebookToGroupAsync(n2, g2);

        // Reorder n2 before n1 in group
        await vm.ReorderNotebooksAsync(n2, n1, insertAfter: false);
        var assignments = await notebookRepo.ListGroupAssignmentsAsync();
        Assert.Equal(g2, assignments[n1]);
        Assert.Equal(g2, assignments[n2]);

        // Drag n3 into g2 by placing it after n1
        await vm.ReorderNotebooksAsync(n3, n1, insertAfter: true);
        assignments = await notebookRepo.ListGroupAssignmentsAsync();
        Assert.Equal(g2, assignments[n3]);

        // Test MoveNoteAsync
        var note = new Note
        {
            Id = "note-test-1",
            Title = "测试笔记",
            BodyHtml = "<p>内容</p>",
            BodyText = "内容",
            BodyJson = "{}",
            NotebookId = null,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        await noteRepo.UpsertAsync(note);
        await vm.MoveNoteAsync(note.Id, n1);

        var updatedNote = await noteRepo.GetAsync(note.Id);
        Assert.NotNull(updatedNote);
        Assert.Equal(n1, updatedNote.NotebookId);
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
}

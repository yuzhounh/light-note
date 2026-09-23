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

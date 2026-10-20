using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class NotebookSelectionTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "LightNote.Tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SelectingNotebookListsOnlyItsNotes()
    {
        var factory = new SqliteConnectionFactory(new AppDataPaths(_directory));
        var logger = new NullLogger();
        await new SqliteDatabaseInitializer(factory, logger).InitializeAsync();
        var notebooks = new SqliteNotebookRepository(factory);
        var notes = new SqliteNoteRepository(factory);
        var now = DateTimeOffset.UtcNow;
        foreach (var id in new[] { "a", "b" })
        {
            await notebooks.UpsertAsync(new Notebook { Id = id, Name = id, CreatedAt = now, UpdatedAt = now });
            for (var i = 0; i < 3; i++)
                await notes.UpsertAsync(new Note
                {
                    Id = $"{id}-{i}", NotebookId = id, Title = id, BodyJson = "{}", BodyHtml = "<p></p>",
                    BodyText = "", CreatedAt = now, UpdatedAt = now,
                });
        }

        var vm = new MainViewModel(notes, notebooks, logger);
        vm.ConfigureNavigation(showRecent: false, showTrash: true);
        await vm.InitializeAsync();
        Assert.Equal(NotebookKind.All, vm.SelectedNotebook!.Kind);
        Assert.Equal(6, vm.Notes.Count);

        vm.SelectedNote = vm.Notes.Where(n => n.Model.NotebookId == "b").Skip(1).First();
        vm.SelectedNotebook = vm.Notebooks.Single(n => n.Id == "b");
        await Task.Delay(1500);
        Assert.Equal("b", vm.SelectedNotebook!.Id);
        Assert.Equal(3, vm.Notes.Count);
        Assert.All(vm.Notes, n => Assert.Equal("b", n.Model.NotebookId));
        Assert.Same(vm.Notes.First(), vm.SelectedNote);
    }

    private sealed class NullLogger : IAppLogger
    {
        public void Info(string message) { }
        public void Error(string message, Exception exception) { }
    }

    public void Dispose()
    {
        try { Directory.Delete(_directory, true); } catch { }
    }
}

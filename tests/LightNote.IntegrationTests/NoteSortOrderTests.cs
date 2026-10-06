using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class NoteSortOrderTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Tests",
        Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData(false, true, "pinned,c3,c2,c1")]
    [InlineData(false, false, "pinned,c1,c2,c3")]
    [InlineData(true, true, "pinned,c1,c3,c2")]
    [InlineData(true, false, "pinned,c2,c3,c1")]
    public async Task ListsFollowSortOrderWithPinnedFirst(bool byUpdated, bool descending, string expected)
    {
        var paths = new AppDataPaths(_testDirectory);
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        var repository = new SqliteNoteRepository(factory);
        var baseTime = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

        // 创建顺序 c1 < c2 < c3；修改顺序 c2 < c3 < c1。
        await repository.UpsertAsync(CreateNote("c1", baseTime.AddDays(1), baseTime.AddDays(30)));
        await repository.UpsertAsync(CreateNote("c2", baseTime.AddDays(2), baseTime.AddDays(10)));
        await repository.UpsertAsync(CreateNote("c3", baseTime.AddDays(3), baseTime.AddDays(20)));
        await repository.UpsertAsync(CreateNote("pinned", baseTime, baseTime, isPinned: true));

        repository.SortOrder = new NoteSortOrder(byUpdated, descending);
        var notes = await repository.ListAsync(null, allNotebooks: true, deletedOnly: false);

        Assert.Equal(expected, string.Join(",", notes.Select(note => note.Id)));
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
    }

    private static Note CreateNote(string id, DateTimeOffset createdAt, DateTimeOffset updatedAt, bool isPinned = false) => new()
    {
        Id = id,
        Title = id,
        BodyJson = "{}",
        BodyHtml = "<p></p>",
        BodyText = string.Empty,
        IsPinned = isPinned,
        CreatedAt = createdAt,
        UpdatedAt = updatedAt,
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

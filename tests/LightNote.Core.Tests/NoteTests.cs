using LightNote.Core.Models;

namespace LightNote.Core.Tests;

public sealed class NoteTests
{
    [Fact]
    public void NewNoteUsesExpectedLocalSyncDefaults()
    {
        var now = DateTimeOffset.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid().ToString(),
            Title = "Test",
            BodyJson = "{}",
            BodyHtml = "",
            BodyText = "",
            CreatedAt = now,
            UpdatedAt = now,
        };

        Assert.Equal(1, note.Version);
        Assert.Equal(SyncState.Dirty, note.SyncState);
        Assert.Null(note.DeletedAt);
    }
}

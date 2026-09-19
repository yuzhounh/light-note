namespace LightNote.Core.Models;

public sealed record NoteSearchHit
{
    public required Note Note { get; init; }

    public required string Snippet { get; init; }
}

namespace LightNote.Core.Models;

public sealed record NoteVersion
{
    public required string Id { get; init; }

    public required string NoteId { get; init; }

    public long Version { get; init; }

    public required string Title { get; init; }

    public required string BodyJson { get; init; }

    public required string BodyHtml { get; init; }

    public required string BodyText { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public bool IsConflict { get; init; }
}

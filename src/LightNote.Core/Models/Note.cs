namespace LightNote.Core.Models;

public sealed record Note
{
    public required string Id { get; init; }

    public string? NotebookId { get; init; }

    public required string Title { get; init; }

    public required string BodyJson { get; init; }

    public required string BodyHtml { get; init; }

    public required string BodyText { get; init; }

    public bool IsPinned { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }

    public long Version { get; init; } = 1;

    public SyncState SyncState { get; init; } = SyncState.Dirty;
}

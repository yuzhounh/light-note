namespace LightNote.Core.Models;

public sealed record Notebook
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public int SortOrder { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }
}

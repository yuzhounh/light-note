namespace LightNote.Core.Models;

public sealed record Tag
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }
}

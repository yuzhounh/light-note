namespace LightNote.Core.Models;

public sealed record SyncResult
{
    public required int Uploaded { get; init; }

    public required int Downloaded { get; init; }

    public required int Conflicts { get; init; }

    public required DateTimeOffset CompletedAt { get; init; }
}

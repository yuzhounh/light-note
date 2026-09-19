namespace LightNote.Core.Models;

public sealed record DatabaseIntegrityResult
{
    public required bool IsHealthy { get; init; }

    public required IReadOnlyList<string> Warnings { get; init; }
}

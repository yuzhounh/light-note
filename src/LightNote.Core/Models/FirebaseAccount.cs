namespace LightNote.Core.Models;

public sealed record FirebaseAccount
{
    public required string UserId { get; init; }

    public required string Email { get; init; }
}

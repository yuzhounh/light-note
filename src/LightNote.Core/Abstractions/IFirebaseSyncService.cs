using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface IFirebaseSyncService
{
    bool IsConfigured { get; }

    string ConfigurationPath { get; }

    string? GoogleClientId { get; }

    FirebaseAccount? CurrentAccount { get; }

    Task<FirebaseAccount?> RestoreSessionAsync(CancellationToken cancellationToken = default);

    Task<FirebaseAccount> SignInAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default);

    Task<FirebaseAccount> SignInWithGoogleAsync(
        string? clientId = null,
        string? clientSecret = null,
        Action<string>? openBrowserUrl = null,
        CancellationToken cancellationToken = default);

    Task SignOutAsync(CancellationToken cancellationToken = default);

    Task<SyncResult> SyncAsync(CancellationToken cancellationToken = default);
}

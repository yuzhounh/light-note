namespace LightNote.Core.Abstractions;

public interface IBackupService
{
    Task<string> CreateAsync(CancellationToken cancellationToken = default);

    Task RestoreAsync(
        string archivePath,
        string emptyTargetDirectory,
        CancellationToken cancellationToken = default);
}

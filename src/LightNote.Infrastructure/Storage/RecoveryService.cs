using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.Infrastructure.Storage;

public sealed class RecoveryService(
    AppDataPaths paths,
    INoteRepository noteRepository,
    IAppLogger logger) : IRecoveryService
{
    private readonly object _fileGate = new();

    public void SaveDraft(Note note)
    {
        paths.EnsureCreated();
        var destination = GetDraftPath(note.Id);
        var temporary = $"{destination}.{Guid.NewGuid():N}.tmp";
        lock (_fileGate)
        {
            try
            {
                File.WriteAllText(temporary, JsonSerializer.Serialize(note), new UTF8Encoding(false));
                File.Move(temporary, destination, overwrite: true);
            }
            finally
            {
                if (File.Exists(temporary))
                {
                    File.Delete(temporary);
                }
            }
        }
    }

    public void ClearDraft(string noteId)
    {
        var path = GetDraftPath(noteId);
        lock (_fileGate)
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    public async Task<int> RecoverAsync(CancellationToken cancellationToken = default)
    {
        paths.EnsureCreated();
        var recoveredCount = 0;
        foreach (var draftPath in Directory.EnumerateFiles(paths.RecoveryDirectory, "*.json"))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var json = await File.ReadAllTextAsync(draftPath, cancellationToken);
                var draft = JsonSerializer.Deserialize<Note>(json)
                    ?? throw new InvalidDataException("恢复草稿为空。");
                var stored = await noteRepository.GetAsync(draft.Id, cancellationToken);
                if (stored is null || draft.UpdatedAt > stored.UpdatedAt)
                {
                    await noteRepository.UpsertAsync(draft with
                    {
                        Version = stored is null
                            ? Math.Max(1, draft.Version)
                            : Math.Max(stored.Version + 1, draft.Version),
                        SyncState = SyncState.Dirty,
                    }, cancellationToken);
                    recoveredCount++;
                }

                File.Delete(draftPath);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.Error($"Failed to recover draft {draftPath}.", exception);
                var invalidPath = $"{draftPath}.invalid-{DateTime.UtcNow:yyyyMMddHHmmss}";
                if (!File.Exists(invalidPath))
                {
                    File.Move(draftPath, invalidPath);
                }
            }
        }

        return recoveredCount;
    }

    private string GetDraftPath(string noteId)
    {
        var safeName = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(noteId)));
        return Path.Combine(paths.RecoveryDirectory, $"{safeName}.json");
    }
}

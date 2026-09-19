using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface IRecoveryService
{
    void SaveDraft(Note note);

    void ClearDraft(string noteId);

    Task<int> RecoverAsync(CancellationToken cancellationToken = default);
}

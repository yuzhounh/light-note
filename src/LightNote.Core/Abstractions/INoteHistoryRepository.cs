using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface INoteHistoryRepository
{
    Task<IReadOnlyList<NoteVersion>> ListAsync(
        string noteId,
        CancellationToken cancellationToken = default);

    Task<NoteVersion?> GetAsync(
        string versionId,
        CancellationToken cancellationToken = default);
}

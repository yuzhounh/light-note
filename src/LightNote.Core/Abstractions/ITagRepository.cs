using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface ITagRepository
{
    Task<IReadOnlyList<Tag>> ListAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Tag>> ListForNoteAsync(
        string noteId,
        CancellationToken cancellationToken = default);

    Task SetForNoteAsync(
        string noteId,
        IReadOnlyCollection<string> tagNames,
        CancellationToken cancellationToken = default);
}

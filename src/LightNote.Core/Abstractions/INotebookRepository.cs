using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface INotebookRepository
{
    Task<IReadOnlyList<Notebook>> ListAsync(CancellationToken cancellationToken = default);

    Task UpsertAsync(Notebook notebook, CancellationToken cancellationToken = default);
}

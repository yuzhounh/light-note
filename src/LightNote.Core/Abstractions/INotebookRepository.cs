using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface INotebookRepository
{
    Task<IReadOnlyList<Notebook>> ListAsync(CancellationToken cancellationToken = default);

    Task UpsertAsync(Notebook notebook, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<NotebookGroup>> ListGroupsAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyDictionary<string, string>> ListGroupAssignmentsAsync(
        CancellationToken cancellationToken = default);

    Task UpsertGroupAsync(NotebookGroup group, CancellationToken cancellationToken = default);

    Task DeleteGroupAsync(string groupId, CancellationToken cancellationToken = default);

    Task AssignToGroupAsync(
        string notebookId,
        string? groupId,
        CancellationToken cancellationToken = default);
}

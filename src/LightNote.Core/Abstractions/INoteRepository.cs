using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface INoteRepository
{
    Task<Note?> GetAsync(string id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Note>> ListAsync(
        string? notebookId,
        bool allNotebooks,
        bool deletedOnly,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default);

    Task<int> CountAsync(
        string? notebookId,
        bool allNotebooks,
        bool deletedOnly,
        CancellationToken cancellationToken = default);

    Task UpsertAsync(Note note, CancellationToken cancellationToken = default);

    Task DeletePermanentlyAsync(string id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Note>> ListRecentAsync(
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Note>> ListPinnedAsync(
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Note>> ListByTagAsync(
        string tagId,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Note>> ListByNotebookIdsAsync(
        IReadOnlyList<string> notebookIds,
        int limit = 50,
        int offset = 0,
        CancellationToken cancellationToken = default);

    Task<int> CountByNotebookIdsAsync(
        IReadOnlyList<string> notebookIds,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<NoteSearchHit>> SearchAsync(
        string query,
        int limit = 100,
        int offset = 0,
        CancellationToken cancellationToken = default);
}

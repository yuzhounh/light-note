using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface INoteRepository
{
    /// <summary>列表查询使用的排序方式（置顶始终优先）。</summary>
    NoteSortOrder SortOrder { get; set; }

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

    /// <param name="forceSnapshot">为 true 时无论距上次快照多久，都保存修改前的内容（例如恢复历史版本前）。</param>
    Task UpsertAsync(Note note, CancellationToken cancellationToken = default, bool forceSnapshot = false);

    Task DeletePermanentlyAsync(string id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Note>> ListRecentAsync(
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

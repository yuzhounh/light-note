using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface IAttachmentService
{
    Task<AttachmentImportResult> ImportAsync(
        string noteId,
        string fileName,
        string declaredMimeType,
        byte[] content,
        CancellationToken cancellationToken = default);

    Task ReconcileReferencesAsync(
        string noteId,
        string bodyHtml,
        CancellationToken cancellationToken = default);

    Task DeleteForNoteAsync(string noteId, CancellationToken cancellationToken = default);

    Task PurgeExpiredAsync(CancellationToken cancellationToken = default);
}

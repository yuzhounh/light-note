using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface INoteImportService
{
    Task<NoteImportResult> ImportAsync(
        NoteImportRequest request,
        CancellationToken cancellationToken = default);
}

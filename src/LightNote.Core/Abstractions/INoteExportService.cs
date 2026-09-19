using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface INoteExportService
{
    Task ExportAsync(
        Note note,
        NoteExportFormat format,
        string destinationPath,
        CancellationToken cancellationToken = default);
}

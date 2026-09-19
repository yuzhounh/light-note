namespace LightNote.Core.Models;

public sealed record NoteImportRequest
{
    public required IReadOnlyList<string> SourcePaths { get; init; }

    public string? NotebookId { get; init; }

    public string? SourceRoot { get; init; }

    public bool PrefixRelativeDirectory { get; init; }
}

public sealed record NoteImportFailure(string SourcePath, string Message);

public sealed record NoteImportResult(
    IReadOnlyList<string> ImportedNoteIds,
    IReadOnlyList<NoteImportFailure> Failures,
    IReadOnlyList<string> Warnings)
{
    public int ImportedCount => ImportedNoteIds.Count;

    public int FailedCount => Failures.Count;
}

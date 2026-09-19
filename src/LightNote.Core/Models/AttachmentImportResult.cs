namespace LightNote.Core.Models;

public sealed record AttachmentImportResult
{
    public required string Id { get; init; }

    public required string RelativePath { get; init; }

    public required string MimeType { get; init; }

    public required long Size { get; init; }

    public required int Width { get; init; }

    public required int Height { get; init; }
}

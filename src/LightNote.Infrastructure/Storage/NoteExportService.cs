using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.Infrastructure.Storage;

public sealed class NoteExportService(AppDataPaths paths) : INoteExportService
{
    private static readonly Regex AttachmentUrlPattern = new(
        "https://lightnote\\.attachments/(?<path>[^\\\"'<>\\s]+)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public async Task ExportAsync(
        Note note,
        NoteExportFormat format,
        string destinationPath,
        CancellationToken cancellationToken = default)
    {
        var fullPath = Path.GetFullPath(destinationPath);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        var content = format switch
        {
            NoteExportFormat.Html => BuildHtml(note),
            NoteExportFormat.PlainText => $"{note.Title}{Environment.NewLine}{Environment.NewLine}{note.BodyText}",
            NoteExportFormat.Markdown => BuildMarkdown(note, fullPath, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(format)),
        };
        await File.WriteAllTextAsync(fullPath, content, new UTF8Encoding(false), cancellationToken);
    }

    private string BuildHtml(Note note)
    {
        var body = AttachmentUrlPattern.Replace(note.BodyHtml, match =>
        {
            var relativePath = Uri.UnescapeDataString(match.Groups["path"].Value).Replace('/', Path.DirectorySeparatorChar);
            var attachmentPath = ResolveAttachmentPath(relativePath);
            if (!File.Exists(attachmentPath))
            {
                return match.Value;
            }

            var mimeType = Path.GetExtension(attachmentPath).ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                ".gif" => "image/gif",
                _ => "application/octet-stream",
            };
            return $"data:{mimeType};base64,{Convert.ToBase64String(File.ReadAllBytes(attachmentPath))}";
        });
        return $$"""
            <!doctype html>
            <html lang="zh-CN">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>{{WebUtility.HtmlEncode(note.Title)}}</title>
              <style>
                body { max-width: 820px; margin: 48px auto; padding: 0 24px; color: #1d2733; font: 16px/1.75 "Segoe UI", sans-serif; }
                img { max-width: 100%; height: auto; }
                blockquote { border-left: 4px solid #d7dce2; margin-left: 0; padding-left: 1em; color: #52606d; }
                pre { padding: 14px 16px; border-radius: 7px; background: #f1f3f5; white-space: pre-wrap; }
              </style>
            </head>
            <body>
              <h1>{{WebUtility.HtmlEncode(note.Title)}}</h1>
              {{body}}
            </body>
            </html>
            """;
    }

    private string BuildMarkdown(Note note, string destinationPath, CancellationToken cancellationToken)
    {
        try
        {
            using var document = JsonDocument.Parse(note.BodyJson);
            var imageMappings = CopyMarkdownImages(document.RootElement, destinationPath, cancellationToken);
            var builder = new StringBuilder();
            builder.Append("# ").AppendLine(note.Title).AppendLine();
            RenderNode(document.RootElement, builder, imageMappings, 0);
            return builder.ToString().TrimEnd() + Environment.NewLine;
        }
        catch (JsonException)
        {
            return $"# {note.Title}{Environment.NewLine}{Environment.NewLine}{note.BodyText}{Environment.NewLine}";
        }
    }

    private Dictionary<string, string> CopyMarkdownImages(
        JsonElement root,
        string destinationPath,
        CancellationToken cancellationToken)
    {
        var mappings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var imageUrls = new List<string>();
        CollectImageUrls(root, imageUrls);
        if (imageUrls.Count == 0)
        {
            return mappings;
        }

        var assetsName = $"{Path.GetFileNameWithoutExtension(destinationPath)}_files";
        var assetsDirectory = Path.Combine(Path.GetDirectoryName(destinationPath)!, assetsName);
        Directory.CreateDirectory(assetsDirectory);
        foreach (var imageUrl in imageUrls.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!TryResolveAttachmentUrl(imageUrl, out var sourcePath) || !File.Exists(sourcePath))
            {
                continue;
            }

            var fileName = Path.GetFileName(sourcePath);
            File.Copy(sourcePath, Path.Combine(assetsDirectory, fileName), overwrite: true);
            mappings[imageUrl] = $"{assetsName}/{fileName}";
        }

        return mappings;
    }

    private static void CollectImageUrls(JsonElement node, ICollection<string> urls)
    {
        if (node.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (node.TryGetProperty("type", out var type) && type.GetString() == "image" &&
            node.TryGetProperty("attrs", out var attrs) && attrs.TryGetProperty("src", out var src) &&
            !string.IsNullOrWhiteSpace(src.GetString()))
        {
            urls.Add(src.GetString()!);
        }

        if (node.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
        {
            foreach (var child in content.EnumerateArray())
            {
                CollectImageUrls(child, urls);
            }
        }
    }

    private static void RenderNode(
        JsonElement node,
        StringBuilder builder,
        IReadOnlyDictionary<string, string> imageMappings,
        int indent)
    {
        if (node.ValueKind != JsonValueKind.Object ||
            !node.TryGetProperty("type", out var typeElement))
        {
            return;
        }

        var type = typeElement.GetString();
        var children = node.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array
            ? content.EnumerateArray().ToArray()
            : [];
        switch (type)
        {
            case "doc":
                foreach (var child in children)
                {
                    RenderNode(child, builder, imageMappings, indent);
                }
                break;
            case "paragraph":
                RenderInline(children, builder, imageMappings);
                builder.AppendLine().AppendLine();
                break;
            case "heading":
                var level = node.TryGetProperty("attrs", out var headingAttrs) &&
                    headingAttrs.TryGetProperty("level", out var levelElement)
                        ? Math.Clamp(levelElement.GetInt32(), 1, 6)
                        : 1;
                builder.Append(new string('#', level)).Append(' ');
                RenderInline(children, builder, imageMappings);
                builder.AppendLine().AppendLine();
                break;
            case "bulletList":
            case "orderedList":
                for (var index = 0; index < children.Length; index++)
                {
                    builder.Append(' ', indent).Append(type == "bulletList" ? "- " : $"{index + 1}. ");
                    RenderListItem(children[index], builder, imageMappings, indent + 2);
                }
                builder.AppendLine();
                break;
            case "blockquote":
                var quote = new StringBuilder();
                foreach (var child in children)
                {
                    RenderNode(child, quote, imageMappings, indent);
                }
                foreach (var line in quote.ToString().TrimEnd().Split(Environment.NewLine))
                {
                    builder.Append("> ").AppendLine(line);
                }
                builder.AppendLine();
                break;
            case "codeBlock":
                builder.AppendLine("```");
                builder.AppendLine(string.Concat(children.Select(GetText)));
                builder.AppendLine("```").AppendLine();
                break;
            default:
                RenderInline(children, builder, imageMappings);
                break;
        }
    }

    private static void RenderListItem(
        JsonElement item,
        StringBuilder builder,
        IReadOnlyDictionary<string, string> imageMappings,
        int indent)
    {
        if (!item.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.Array)
        {
            builder.AppendLine();
            return;
        }

        var children = content.EnumerateArray().ToArray();
        if (children.Length > 0 && children[0].TryGetProperty("content", out var inline))
        {
            RenderInline(inline.EnumerateArray().ToArray(), builder, imageMappings);
        }
        builder.AppendLine();
        foreach (var child in children.Skip(1))
        {
            RenderNode(child, builder, imageMappings, indent);
        }
    }

    private static void RenderInline(
        IReadOnlyList<JsonElement> children,
        StringBuilder builder,
        IReadOnlyDictionary<string, string> imageMappings)
    {
        foreach (var child in children)
        {
            var type = child.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;
            if (type == "hardBreak")
            {
                builder.Append("  ").AppendLine();
                continue;
            }
            if (type == "image" && child.TryGetProperty("attrs", out var attrs))
            {
                var src = attrs.TryGetProperty("src", out var srcElement) ? srcElement.GetString() ?? string.Empty : string.Empty;
                var alt = attrs.TryGetProperty("alt", out var altElement) ? altElement.GetString() ?? "图片" : "图片";
                builder.Append("![").Append(alt.Replace("]", "\\]", StringComparison.Ordinal)).Append("](")
                    .Append(imageMappings.GetValueOrDefault(src, src)).Append(')');
                continue;
            }

            var text = GetText(child);
            if (child.TryGetProperty("marks", out var marks) && marks.ValueKind == JsonValueKind.Array)
            {
                foreach (var mark in marks.EnumerateArray())
                {
                    var markType = mark.TryGetProperty("type", out var markTypeElement)
                        ? markTypeElement.GetString()
                        : null;
                    text = markType switch
                    {
                        "bold" => $"**{text}**",
                        "italic" => $"*{text}*",
                        "code" => $"`{text.Replace("`", "\\`", StringComparison.Ordinal)}`",
                        _ => text,
                    };
                }
            }
            builder.Append(text);
        }
    }

    private static string GetText(JsonElement node) =>
        node.TryGetProperty("text", out var text) ? text.GetString() ?? string.Empty : string.Empty;

    private bool TryResolveAttachmentUrl(string url, out string path)
    {
        path = string.Empty;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            !string.Equals(uri.Host, "lightnote.attachments", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        path = ResolveAttachmentPath(Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')));
        return true;
    }

    private string ResolveAttachmentPath(string relativePath)
    {
        var root = Path.GetFullPath(paths.AttachmentsDirectory);
        var candidate = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("附件路径超出数据目录。");
        }
        return candidate;
    }
}

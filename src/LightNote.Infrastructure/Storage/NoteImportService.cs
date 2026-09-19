using System.Net;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.Infrastructure.Storage;

public sealed class NoteImportService(
    INoteRepository noteRepository,
    ITagRepository? tagRepository = null,
    IAttachmentService? attachmentService = null) : INoteImportService
{
    private const long MaximumFileSize = 10 * 1024 * 1024;
    private const long MaximumArchiveFileSize = 100 * 1024 * 1024;
    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".md", ".markdown", ".txt", ".html", ".htm", ".enex", ".json", ".csv",
    };
    private static readonly Regex MarkdownHeadingPattern = new(
        "^(?<marks>#{1,6})\\s+(?<text>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex BulletPattern = new(
        "^\\s*[-+*]\\s+(?<text>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex OrderedPattern = new(
        "^\\s*\\d+[.)]\\s+(?<text>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex MarkdownImagePattern = new(
        "!\\[(?<alt>[^]]*)]\\((?:<(?<anglePath>[^>]+)>|(?<path>[^)\\s]+))(?:\\s+[\"'][^\"']*[\"'])?\\)",
        RegexOptions.Compiled);
    private static readonly Regex InlinePattern = new(
        "(?<code>`[^`\\r\\n]+`)|(?<bold>\\*\\*[^*\\r\\n]+\\*\\*)|(?<italic>\\*[^*\\r\\n]+\\*)",
        RegexOptions.Compiled);
    private static readonly Regex UnsafeHtmlPattern = new(
        "<(script|style|iframe|object|embed)\\b[^>]*>.*?</\\1\\s*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);
    private static readonly Regex HtmlCommentPattern = new(
        "<!--.*?-->",
        RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex HtmlImagePattern = new(
        "<img\\b[^>]*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex HtmlImageSourcePattern = new(
        "<img\\b[^>]*?src\\s*=\\s*['\"](?<path>[^'\"]+)['\"][^>]*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex HtmlBreakPattern = new(
        "<(br\\s*/?|/p|/div|/h[1-6]|/li|/blockquote|/pre)\\s*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex HtmlTagPattern = new(
        "<[^>]+>",
        RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex HtmlArticlePattern = new(
        "<article\\b[^>]*>(?<body>.*?)</article\\s*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);
    private static readonly Regex HtmlHeadingPattern = new(
        "<h[1-3]\\b[^>]*>(?<text>.*?)</h[1-3]\\s*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);
    private static readonly Regex HtmlTitlePattern = new(
        "<title\\b[^>]*>(?<text>.*?)</title\\s*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);
    private static readonly Regex HtmlTimePattern = new(
        "<time\\b[^>]*datetime\\s*=\\s*['\"](?<value>[^'\"]+)['\"][^>]*>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex EnexMediaPattern = new(
        "<en-media\\b[^>]*(?:/>|>.*?</en-media\\s*>)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.Singleline);

    public async Task<NoteImportResult> ImportAsync(
        NoteImportRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var importedIds = new List<string>();
        var failures = new List<NoteImportFailure>();
        var warnings = new List<string>();

        foreach (var sourcePath in request.SourcePaths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var imported = await ImportFileAsync(request, sourcePath, warnings, cancellationToken);
                importedIds.AddRange(imported.Select(note => note.Id));
            }
            catch (Exception exception) when (
                exception is IOException or UnauthorizedAccessException or InvalidDataException or NotSupportedException or
                    JsonException or XmlException)
            {
                failures.Add(new NoteImportFailure(sourcePath, exception.Message));
            }
        }

        return new NoteImportResult(importedIds, failures, warnings);
    }

    private async Task<IReadOnlyList<Note>> ImportFileAsync(
        NoteImportRequest request,
        string sourcePath,
        ICollection<string> warnings,
        CancellationToken cancellationToken)
    {
        var fullPath = Path.GetFullPath(sourcePath);
        var extension = Path.GetExtension(fullPath);
        if (!SupportedExtensions.Contains(extension))
        {
            throw new NotSupportedException($"不支持 {extension} 文件。");
        }

        var file = new FileInfo(fullPath);
        if (!file.Exists)
        {
            throw new FileNotFoundException("找不到导入文件。", fullPath);
        }
        var maximumSize = extension.Equals(".enex", StringComparison.OrdinalIgnoreCase)
            ? MaximumArchiveFileSize
            : MaximumFileSize;
        if (file.Length > maximumSize)
        {
            throw new InvalidDataException($"文件超过 {maximumSize / 1024 / 1024} MB 导入限制。");
        }

        var (source, usedLegacyEncoding) = await ReadTextAsync(fullPath, cancellationToken);
        if (usedLegacyEncoding)
        {
            warnings.Add($"{file.Name}：文件不是 UTF-8，已按简体中文 Windows 编码读取。");
        }
        IReadOnlyList<ImportedDocument> documents;
        if (extension is ".md" or ".markdown")
        {
            var attachments = new List<ImportedAttachment>();
            foreach (Match match in MarkdownImagePattern.Matches(source))
            {
                var rawPath = match.Groups["anglePath"].Success
                    ? match.Groups["anglePath"].Value
                    : match.Groups["path"].Value;
                var attachment = await TryReadLocalImageAsync(
                    rawPath,
                    file.DirectoryName ?? string.Empty,
                    $"{file.Name}：{rawPath}",
                    warnings,
                    cancellationToken);
                if (attachment is not null)
                {
                    attachments.Add(attachment with { Alt = match.Groups["alt"].Value });
                }
            }
            source = MarkdownImagePattern.Replace(source, string.Empty);
            documents = [new ImportedDocument(null, ParseMarkdown(source), Attachments: attachments)];
        }
        else if (extension is ".html" or ".htm")
        {
            var attachments = new List<ImportedAttachment>();
            var importedImageSources = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (Match match in HtmlImageSourcePattern.Matches(source))
            {
                var rawPath = WebUtility.HtmlDecode(match.Groups["path"].Value);
                var attachment = await TryReadLocalImageAsync(
                    rawPath,
                    file.DirectoryName ?? string.Empty,
                    $"{file.Name}：{rawPath}",
                    warnings,
                    cancellationToken);
                if (attachment is not null)
                {
                    attachments.Add(attachment);
                    importedImageSources.Add(rawPath);
                }
            }
            source = HtmlImageSourcePattern.Replace(source, match =>
                importedImageSources.Contains(WebUtility.HtmlDecode(match.Groups["path"].Value))
                    ? string.Empty
                    : " [图片] ");
            source = HtmlImagePattern.Replace(source, " [图片] ");
            var htmlDocuments = ParseHtmlDocuments(source, file).ToList();
            if (attachments.Count > 0)
            {
                htmlDocuments[0] = htmlDocuments[0] with { Attachments = attachments };
                if (htmlDocuments.Count > 1)
                {
                    warnings.Add($"{file.Name}：页面包含多篇内容，HTML 图片已归入第一篇笔记。");
                }
            }
            documents = htmlDocuments;
        }
        else if (extension == ".enex")
        {
            documents = ParseEnex(source, file, warnings);
        }
        else if (extension == ".json")
        {
            documents = [await ParseGoogleKeepJsonAsync(source, file, warnings, cancellationToken)];
        }
        else if (extension == ".csv")
        {
            documents = ParseCsvDocuments(source, file, warnings);
        }
        else
        {
            documents = [new ImportedDocument(null, ParsePlainText(source))];
        }

        var now = DateTimeOffset.UtcNow;
        var fileCreatedAt = ToUsableTimestamp(file.CreationTimeUtc, now);
        var fileUpdatedAt = ToUsableTimestamp(file.LastWriteTimeUtc, now);
        var notes = new List<Note>(documents.Count);
        foreach (var document in documents)
        {
            var blocks = document.Blocks.Count == 0
                ? [new ImportedBlock(BlockKind.Paragraph, string.Empty)]
                : document.Blocks.ToList();
            var createdAt = document.CreatedAt ?? fileCreatedAt;
            var updatedAt = document.UpdatedAt ?? fileUpdatedAt;
            if (updatedAt < createdAt)
            {
                createdAt = updatedAt;
            }

            var note = new Note
            {
                Id = Guid.NewGuid().ToString(),
                NotebookId = request.NotebookId,
                Title = string.IsNullOrWhiteSpace(document.Title)
                    ? BuildTitle(request, fullPath)
                    : document.Title.Trim(),
                BodyJson = BuildJson(blocks),
                BodyHtml = BuildHtml(blocks),
                BodyText = BuildText(blocks),
                IsPinned = document.IsPinned,
                CreatedAt = createdAt,
                UpdatedAt = updatedAt,
                SyncState = SyncState.Dirty,
            };
            await noteRepository.UpsertAsync(note, cancellationToken);
            if (attachmentService is not null && document.Attachments is { Count: > 0 })
            {
                foreach (var attachment in document.Attachments)
                {
                    try
                    {
                        var imported = await attachmentService.ImportAsync(
                            note.Id,
                            attachment.FileName,
                            attachment.MimeType,
                            attachment.Content,
                            cancellationToken);
                        blocks.Add(new ImportedBlock(BlockKind.Image, attachment.Alt, Image: imported));
                    }
                    catch (InvalidDataException exception)
                    {
                        warnings.Add($"{file.Name}：{attachment.FileName} 未导入（{exception.Message}）");
                    }
                }

                note = note with
                {
                    BodyJson = BuildJson(blocks),
                    BodyHtml = BuildHtml(blocks),
                    BodyText = BuildText(blocks),
                    Version = note.Version + 1,
                };
                await noteRepository.UpsertAsync(note, cancellationToken);
            }
            if (tagRepository is not null && document.Tags is { Count: > 0 })
            {
                await tagRepository.SetForNoteAsync(note.Id, document.Tags, cancellationToken);
                await noteRepository.UpsertAsync(note, cancellationToken);
            }
            notes.Add(note);
        }
        return notes;
    }

    private static string BuildTitle(NoteImportRequest request, string fullPath)
    {
        var title = Path.GetFileNameWithoutExtension(fullPath).Trim();
        if (request.PrefixRelativeDirectory && !string.IsNullOrWhiteSpace(request.SourceRoot))
        {
            var relativeDirectory = Path.GetDirectoryName(Path.GetRelativePath(
                Path.GetFullPath(request.SourceRoot),
                fullPath));
            if (!string.IsNullOrWhiteSpace(relativeDirectory) && relativeDirectory != ".")
            {
                title = $"{relativeDirectory.Replace(Path.DirectorySeparatorChar, '/')} / {title}";
            }
        }

        return string.IsNullOrWhiteSpace(title) ? "无标题" : title;
    }

    private static async Task<(string Text, bool UsedLegacyEncoding)> ReadTextAsync(
        string path,
        CancellationToken cancellationToken)
    {
        var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
        if (bytes.AsSpan().StartsWith(new byte[] { 0xEF, 0xBB, 0xBF }))
        {
            return (Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3), false);
        }
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFF, 0xFE }))
        {
            return (Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2), false);
        }
        if (bytes.AsSpan().StartsWith(new byte[] { 0xFE, 0xFF }))
        {
            return (Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2), false);
        }

        try
        {
            return (new UTF8Encoding(false, true).GetString(bytes), false);
        }
        catch (DecoderFallbackException)
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            return (Encoding.GetEncoding(936).GetString(bytes), true);
        }
    }

    private static DateTimeOffset ToUsableTimestamp(DateTime value, DateTimeOffset fallback) =>
        value.Year >= 1970 ? new DateTimeOffset(value, TimeSpan.Zero) : fallback;

    private static IReadOnlyList<ImportedBlock> ParseMarkdown(string source)
    {
        var lines = NormalizeLineEndings(source).Split('\n');
        var blocks = new List<ImportedBlock>();
        for (var index = 0; index < lines.Length;)
        {
            var line = lines[index];
            if (string.IsNullOrWhiteSpace(line))
            {
                index++;
                continue;
            }

            if (line.TrimStart().StartsWith("```", StringComparison.Ordinal))
            {
                index++;
                var code = new List<string>();
                while (index < lines.Length && !lines[index].TrimStart().StartsWith("```", StringComparison.Ordinal))
                {
                    code.Add(lines[index++]);
                }
                if (index < lines.Length)
                {
                    index++;
                }
                blocks.Add(new ImportedBlock(BlockKind.Code, string.Join("\n", code)));
                continue;
            }

            var heading = MarkdownHeadingPattern.Match(line);
            if (heading.Success)
            {
                blocks.Add(new ImportedBlock(
                    BlockKind.Heading,
                    heading.Groups["text"].Value.Trim(),
                    Math.Clamp(heading.Groups["marks"].Value.Length, 1, 2)));
                index++;
                continue;
            }

            if (BulletPattern.IsMatch(line) || OrderedPattern.IsMatch(line))
            {
                var ordered = OrderedPattern.IsMatch(line);
                var items = new List<string>();
                while (index < lines.Length)
                {
                    var match = (ordered ? OrderedPattern : BulletPattern).Match(lines[index]);
                    if (!match.Success)
                    {
                        break;
                    }
                    items.Add(match.Groups["text"].Value.Trim());
                    index++;
                }
                blocks.Add(new ImportedBlock(
                    ordered ? BlockKind.OrderedList : BlockKind.BulletList,
                    string.Empty,
                    Items: items));
                continue;
            }

            if (line.TrimStart().StartsWith(">", StringComparison.Ordinal))
            {
                var quote = new List<string>();
                while (index < lines.Length && lines[index].TrimStart().StartsWith(">", StringComparison.Ordinal))
                {
                    quote.Add(lines[index].TrimStart().TrimStart('>').TrimStart());
                    index++;
                }
                blocks.Add(new ImportedBlock(BlockKind.Quote, string.Join("\n", quote)));
                continue;
            }

            var paragraph = new List<string>();
            while (index < lines.Length &&
                   !string.IsNullOrWhiteSpace(lines[index]) &&
                   (paragraph.Count == 0 || !IsMarkdownBlockStart(lines[index])))
            {
                paragraph.Add(lines[index++]);
            }
            blocks.Add(new ImportedBlock(BlockKind.Paragraph, string.Join("\n", paragraph)));
        }

        return blocks;
    }

    private static bool IsMarkdownBlockStart(string line) =>
        line.TrimStart().StartsWith("```", StringComparison.Ordinal) ||
        line.TrimStart().StartsWith(">", StringComparison.Ordinal) ||
        MarkdownHeadingPattern.IsMatch(line) ||
        BulletPattern.IsMatch(line) ||
        OrderedPattern.IsMatch(line);

    private static IReadOnlyList<ImportedBlock> ParsePlainText(string source) =>
        Regex.Split(NormalizeLineEndings(source), "\\n[ \\t]*\\n+")
            .Select(paragraph => paragraph.Trim())
            .Where(paragraph => paragraph.Length > 0)
            .Select(paragraph => new ImportedBlock(BlockKind.Paragraph, paragraph))
            .ToArray();

    private static IReadOnlyList<ImportedDocument> ParseHtmlDocuments(string html, FileInfo file)
    {
        var articles = HtmlArticlePattern.Matches(html);
        if (articles.Count < 2)
        {
            var titleMatch = HtmlTitlePattern.Match(html);
            if (!titleMatch.Success)
            {
                titleMatch = HtmlHeadingPattern.Match(html);
            }
            var title = titleMatch.Success ? ExtractTextFromHtml(titleMatch.Groups["text"].Value) : null;
            return [new ImportedDocument(title, ParsePlainText(ExtractTextFromHtml(html)))];
        }

        return articles.Select((match, index) =>
        {
            var body = match.Groups["body"].Value;
            var text = ExtractTextFromHtml(body);
            var heading = HtmlHeadingPattern.Match(body);
            var title = heading.Success
                ? ExtractTextFromHtml(heading.Groups["text"].Value)
                : BuildGeneratedTitle(text, $"{Path.GetFileNameWithoutExtension(file.Name)} {index + 1}");
            var timestamp = TryParseFlexibleTimestamp(HtmlTimePattern.Match(body).Groups["value"].Value);
            return new ImportedDocument(title, ParsePlainText(text), timestamp, timestamp);
        }).ToArray();
    }

    private static IReadOnlyList<ImportedDocument> ParseEnex(
        string source,
        FileInfo file,
        ICollection<string> warnings)
    {
        using var stringReader = new StringReader(source);
        using var xmlReader = XmlReader.Create(stringReader, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Ignore,
            XmlResolver = null,
            MaxCharactersInDocument = MaximumArchiveFileSize,
        });
        var root = XDocument.Load(xmlReader, LoadOptions.None).Root
            ?? throw new InvalidDataException("ENEX 文件没有根元素。");
        if (!root.Name.LocalName.Equals("en-export", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("文件不是有效的 ENEX 导出。");
        }

        var documents = new List<ImportedDocument>();
        var hasUnsupportedMedia = false;
        var hasTags = false;
        foreach (var element in root.Elements().Where(item => item.Name.LocalName == "note"))
        {
            var title = ChildValue(element, "title");
            var content = ChildValue(element, "content");
            var mediaCount = EnexMediaPattern.Matches(content).Count;
            var attachments = new List<ImportedAttachment>();
            foreach (var resource in element.Elements().Where(item => item.Name.LocalName == "resource"))
            {
                var mimeType = ChildValue(resource, "mime").Trim().ToLowerInvariant();
                var encoded = ChildValue(resource, "data").Trim();
                if (!IsSupportedImageMimeType(mimeType) || encoded.Length == 0)
                {
                    hasUnsupportedMedia = true;
                    continue;
                }
                try
                {
                    var attributes = resource.Elements()
                        .FirstOrDefault(item => item.Name.LocalName == "resource-attributes");
                    var fileName = attributes is null ? string.Empty : ChildValue(attributes, "file-name");
                    attachments.Add(new ImportedAttachment(
                        string.IsNullOrWhiteSpace(fileName) ? $"evernote-image.{ExtensionForMimeType(mimeType)}" : fileName,
                        mimeType,
                        Convert.FromBase64String(Regex.Replace(encoded, "\\s+", string.Empty)),
                        string.IsNullOrWhiteSpace(fileName) ? "Evernote 图片" : fileName));
                }
                catch (FormatException)
                {
                    hasUnsupportedMedia = true;
                }
            }
            if (mediaCount > attachments.Count)
            {
                hasUnsupportedMedia = true;
            }
            content = EnexMediaPattern.Replace(content, attachments.Count > 0 ? " " : " [附件或图片] ");
            var blocks = ParsePlainText(ExtractTextFromHtml(content)).ToList();
            var tags = element.Elements()
                .Where(item => item.Name.LocalName == "tag")
                .Select(item => item.Value.Trim())
                .Where(value => value.Length > 0)
                .ToArray();
            hasTags |= tags.Length > 0;
            documents.Add(new ImportedDocument(
                string.IsNullOrWhiteSpace(title) ? BuildGeneratedTitle(BuildText(blocks), file.Name) : title,
                blocks,
                TryParseEnexTimestamp(ChildValue(element, "created")),
                TryParseEnexTimestamp(ChildValue(element, "updated")),
                Tags: tags,
                Attachments: attachments));
        }

        if (documents.Count == 0)
        {
            throw new InvalidDataException("ENEX 文件中没有可导入的笔记。");
        }
        if (hasUnsupportedMedia)
        {
            warnings.Add($"{file.Name}：ENEX 中无法匹配或不受支持的附件已保留占位说明。");
        }
        if (hasTags)
        {
            warnings.Add($"{file.Name}：标签已导入为 LightNote 标签。");
        }
        return documents;
    }

    private static async Task<ImportedDocument> ParseGoogleKeepJsonAsync(
        string source,
        FileInfo file,
        ICollection<string> warnings,
        CancellationToken cancellationToken)
    {
        using var json = JsonDocument.Parse(source, new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip,
        });
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            (!root.TryGetProperty("textContent", out _) && !root.TryGetProperty("listContent", out _)))
        {
            throw new InvalidDataException("JSON 不是可识别的 Google Keep 笔记。");
        }

        var blocks = new List<ImportedBlock>();
        var text = GetJsonString(root, "textContent");
        if (!string.IsNullOrWhiteSpace(text))
        {
            blocks.AddRange(ParsePlainText(text));
        }
        if (root.TryGetProperty("listContent", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            var items = list.EnumerateArray().Select(item =>
            {
                var itemText = GetJsonString(item, "text");
                var checkedPrefix = item.TryGetProperty("isChecked", out var checkedValue) && checkedValue.ValueKind == JsonValueKind.True
                    ? "☑ "
                    : "☐ ";
                return checkedPrefix + itemText;
            }).Where(item => item.Length > 2).ToArray();
            if (items.Length > 0)
            {
                blocks.Add(new ImportedBlock(BlockKind.BulletList, string.Empty, Items: items));
            }
        }

        var labels = root.TryGetProperty("labels", out var labelArray) && labelArray.ValueKind == JsonValueKind.Array
            ? labelArray.EnumerateArray().Select(label => GetJsonString(label, "name"))
                .Where(label => !string.IsNullOrWhiteSpace(label)).ToArray()
            : [];
        var importedAttachments = new List<ImportedAttachment>();
        if (root.TryGetProperty("attachments", out var attachments) && attachments.ValueKind == JsonValueKind.Array)
        {
            foreach (var attachmentElement in attachments.EnumerateArray())
            {
                var rawPath = GetJsonString(attachmentElement, "filePath");
                var attachment = await TryReadLocalImageAsync(
                    rawPath,
                    file.DirectoryName ?? string.Empty,
                    $"{file.Name}：{rawPath}",
                    warnings,
                    cancellationToken);
                if (attachment is not null)
                {
                    importedAttachments.Add(attachment);
                }
            }
        }

        var bodyText = BuildText(blocks);
        var title = GetJsonString(root, "title");
        return new ImportedDocument(
            string.IsNullOrWhiteSpace(title) ? BuildGeneratedTitle(bodyText, file.Name) : title,
            blocks,
            TryParseGoogleTimestamp(root, "createdTimestampUsec"),
            TryParseGoogleTimestamp(root, "userEditedTimestampUsec"),
            root.TryGetProperty("isPinned", out var pinned) && pinned.ValueKind == JsonValueKind.True,
            labels,
            importedAttachments);
    }

    private static async Task<ImportedAttachment?> TryReadLocalImageAsync(
        string rawPath,
        string baseDirectory,
        string warningPrefix,
        ICollection<string> warnings,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(rawPath) ||
            Uri.TryCreate(rawPath, UriKind.Absolute, out var uri) && !uri.IsFile)
        {
            warnings.Add($"{warningPrefix} 不是可导入的本地图片。");
            return null;
        }

        var decodedPath = Uri.UnescapeDataString(rawPath.Trim().Trim('<', '>'));
        var fullPath = Path.GetFullPath(Path.IsPathRooted(decodedPath)
            ? decodedPath
            : Path.Combine(baseDirectory, decodedPath));
        var mimeType = MimeTypeForExtension(Path.GetExtension(fullPath));
        if (mimeType is null || !File.Exists(fullPath))
        {
            warnings.Add($"{warningPrefix} 不存在或格式不受支持。");
            return null;
        }

        var file = new FileInfo(fullPath);
        if (file.Length is <= 0 or > 20 * 1024 * 1024)
        {
            warnings.Add($"{warningPrefix} 超出 20 MB 图片限制。");
            return null;
        }

        return new ImportedAttachment(
            file.Name,
            mimeType,
            await File.ReadAllBytesAsync(fullPath, cancellationToken),
            Path.GetFileNameWithoutExtension(file.Name));
    }

    private static bool IsSupportedImageMimeType(string mimeType) =>
        mimeType is "image/png" or "image/jpeg" or "image/webp" or "image/gif";

    private static string? MimeTypeForExtension(string extension) => extension.ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => null,
    };

    private static string ExtensionForMimeType(string mimeType) => mimeType switch
    {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "bin",
    };

    private static IReadOnlyList<ImportedDocument> ParseCsvDocuments(
        string source,
        FileInfo file,
        ICollection<string> warnings)
    {
        var rows = ParseCsv(source);
        if (rows.Count < 2)
        {
            throw new InvalidDataException("CSV 中没有可导入的数据行。");
        }

        var headers = rows[0].Select(NormalizeHeader).ToArray();
        var titleIndex = FindHeader(headers, "title", "name", "标题", "名称");
        var contentIndex = FindHeader(headers, "content", "text", "body", "memo", "正文", "内容", "笔记");
        var createdIndex = FindHeader(headers, "created", "createdat", "createdtime", "create_time", "created_at", "创建时间");
        var updatedIndex = FindHeader(headers, "updated", "updatedat", "updatedtime", "update_time", "updated_at", "修改时间");
        var tagsIndex = FindHeader(headers, "tags", "tag", "labels", "标签");
        if (contentIndex < 0)
        {
            throw new InvalidDataException("CSV 缺少可识别的正文列（content/text/body/正文/内容）。");
        }

        var documents = new List<ImportedDocument>();
        foreach (var row in rows.Skip(1))
        {
            var content = GetCsvValue(row, contentIndex).Trim();
            if (content.Length == 0)
            {
                continue;
            }
            var blocks = ParsePlainText(content).ToList();
            var tags = ParseTags(GetCsvValue(row, tagsIndex));
            var title = GetCsvValue(row, titleIndex).Trim();
            documents.Add(new ImportedDocument(
                title.Length == 0 ? BuildGeneratedTitle(content, file.Name) : title,
                blocks,
                TryParseFlexibleTimestamp(GetCsvValue(row, createdIndex)),
                TryParseFlexibleTimestamp(GetCsvValue(row, updatedIndex)),
                Tags: tags));
        }
        if (documents.Count == 0)
        {
            throw new InvalidDataException("CSV 中没有非空笔记。");
        }
        if (tagsIndex >= 0)
        {
            warnings.Add($"{file.Name}：CSV 标签已导入为 LightNote 标签。");
        }
        return documents;
    }

    private static IReadOnlyList<IReadOnlyList<string>> ParseCsv(string source)
    {
        var rows = new List<IReadOnlyList<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var index = 0; index < source.Length; index++)
        {
            var character = source[index];
            if (character == '"')
            {
                if (quoted && index + 1 < source.Length && source[index + 1] == '"')
                {
                    field.Append('"');
                    index++;
                }
                else
                {
                    quoted = !quoted;
                }
            }
            else if (character == ',' && !quoted)
            {
                row.Add(field.ToString());
                field.Clear();
            }
            else if ((character == '\n' || character == '\r') && !quoted)
            {
                if (character == '\r' && index + 1 < source.Length && source[index + 1] == '\n')
                {
                    index++;
                }
                row.Add(field.ToString());
                field.Clear();
                if (row.Any(value => value.Length > 0))
                {
                    rows.Add(row.ToArray());
                }
                row.Clear();
            }
            else
            {
                field.Append(character);
            }
        }
        row.Add(field.ToString());
        if (row.Any(value => value.Length > 0))
        {
            rows.Add(row.ToArray());
        }
        return rows;
    }

    private static string ChildValue(XElement parent, string localName) =>
        parent.Elements().FirstOrDefault(element => element.Name.LocalName == localName)?.Value ?? string.Empty;

    private static string GetJsonString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : string.Empty;

    private static DateTimeOffset? TryParseEnexTimestamp(string value) =>
        DateTimeOffset.TryParseExact(value, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var timestamp)
            ? timestamp
            : null;

    private static DateTimeOffset? TryParseGoogleTimestamp(JsonElement root, string propertyName)
    {
        if (!root.TryGetProperty(propertyName, out var value))
        {
            return null;
        }
        var raw = value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText();
        return long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var microseconds)
            ? DateTimeOffset.FromUnixTimeMilliseconds(microseconds / 1000)
            : null;
    }

    private static DateTimeOffset? TryParseFlexibleTimestamp(string value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var timestamp) ||
        DateTimeOffset.TryParse(value, CultureInfo.GetCultureInfo("zh-CN"), DateTimeStyles.AssumeLocal, out timestamp)
            ? timestamp
            : null;

    private static string BuildGeneratedTitle(string text, string fallback)
    {
        var firstLine = NormalizeLineEndings(text).Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim()).FirstOrDefault(line => line.Length > 0);
        if (string.IsNullOrWhiteSpace(firstLine))
        {
            return Path.GetFileNameWithoutExtension(fallback);
        }
        return firstLine.Length <= 40 ? firstLine : firstLine[..40] + "…";
    }

    private static int FindHeader(IReadOnlyList<string> headers, params string[] candidates) =>
        Enumerable.Range(0, headers.Count).FirstOrDefault(
            index => candidates.Contains(headers[index], StringComparer.OrdinalIgnoreCase), -1);

    private static string NormalizeHeader(string header) =>
        header.Trim().TrimStart('\uFEFF').Replace(" ", string.Empty, StringComparison.Ordinal).ToLowerInvariant();

    private static string GetCsvValue(IReadOnlyList<string> row, int index) =>
        index >= 0 && index < row.Count ? row[index] : string.Empty;

    private static IReadOnlyList<string> ParseTags(string value) =>
        value.Split(
                [',', '，', ';', '；', '#'],
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.CurrentCultureIgnoreCase)
            .ToArray();

    private static string ExtractTextFromHtml(string html)
    {
        var safe = UnsafeHtmlPattern.Replace(html, string.Empty);
        safe = HtmlCommentPattern.Replace(safe, string.Empty);
        safe = HtmlImagePattern.Replace(safe, " [图片] ");
        safe = HtmlBreakPattern.Replace(safe, "\n");
        safe = HtmlTagPattern.Replace(safe, string.Empty);
        safe = WebUtility.HtmlDecode(safe);
        return Regex.Replace(safe, "[ \\t]+", " ").Trim();
    }

    private static string BuildJson(IReadOnlyList<ImportedBlock> blocks)
    {
        var content = blocks.Select(BuildJsonNode).ToArray();
        return JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["type"] = "doc",
            ["content"] = content,
        });
    }

    private static object BuildJsonNode(ImportedBlock block) => block.Kind switch
    {
        BlockKind.Heading => new Dictionary<string, object?>
        {
            ["type"] = "heading",
            ["attrs"] = new Dictionary<string, object?> { ["level"] = block.Level },
            ["content"] = BuildInlineJson(block.Text),
        },
        BlockKind.Code => new Dictionary<string, object?>
        {
            ["type"] = "codeBlock",
            ["content"] = BuildTextNodeArray(block.Text),
        },
        BlockKind.Quote => new Dictionary<string, object?>
        {
            ["type"] = "blockquote",
            ["content"] = new[] { BuildParagraphNode(block.Text) },
        },
        BlockKind.BulletList or BlockKind.OrderedList => new Dictionary<string, object?>
        {
            ["type"] = block.Kind == BlockKind.BulletList ? "bulletList" : "orderedList",
            ["content"] = (block.Items ?? []).Select(item => new Dictionary<string, object?>
            {
                ["type"] = "listItem",
                ["content"] = new[] { BuildParagraphNode(item) },
            }).ToArray(),
        },
        BlockKind.Image when block.Image is not null => new Dictionary<string, object?>
        {
            ["type"] = "image",
            ["attrs"] = new Dictionary<string, object?>
            {
                ["src"] = $"https://lightnote.attachments/{block.Image.RelativePath.Replace('\\', '/')}",
                ["alt"] = block.Text,
                ["attachmentId"] = block.Image.Id,
                ["width"] = block.Image.Width,
                ["height"] = block.Image.Height,
            },
        },
        _ => BuildParagraphNode(block.Text),
    };

    private static Dictionary<string, object?> BuildParagraphNode(string text) => new()
    {
        ["type"] = "paragraph",
        ["content"] = BuildInlineJson(text),
    };

    private static object[] BuildInlineJson(string text)
    {
        var nodes = new List<object>();
        var lines = NormalizeLineEndings(text).Split('\n');
        for (var lineIndex = 0; lineIndex < lines.Length; lineIndex++)
        {
            foreach (var segment in ParseInline(lines[lineIndex]))
            {
                var node = new Dictionary<string, object?>
                {
                    ["type"] = "text",
                    ["text"] = segment.Text,
                };
                if (segment.Mark is not null)
                {
                    node["marks"] = new[]
                    {
                        new Dictionary<string, object?> { ["type"] = segment.Mark },
                    };
                }
                if (segment.Text.Length > 0)
                {
                    nodes.Add(node);
                }
            }

            if (lineIndex < lines.Length - 1)
            {
                nodes.Add(new Dictionary<string, object?> { ["type"] = "hardBreak" });
            }
        }
        return nodes.ToArray();
    }

    private static object[] BuildTextNodeArray(string text) => text.Length == 0
        ? []
        : [new Dictionary<string, object?> { ["type"] = "text", ["text"] = text }];

    private static string BuildHtml(IReadOnlyList<ImportedBlock> blocks)
    {
        var builder = new StringBuilder();
        foreach (var block in blocks)
        {
            switch (block.Kind)
            {
                case BlockKind.Heading:
                    builder.Append("<h").Append(block.Level).Append('>')
                        .Append(RenderInlineHtml(block.Text)).Append("</h").Append(block.Level).Append('>');
                    break;
                case BlockKind.Code:
                    builder.Append("<pre><code>").Append(WebUtility.HtmlEncode(block.Text)).Append("</code></pre>");
                    break;
                case BlockKind.Quote:
                    builder.Append("<blockquote><p>").Append(RenderInlineHtml(block.Text)).Append("</p></blockquote>");
                    break;
                case BlockKind.BulletList:
                case BlockKind.OrderedList:
                    var tag = block.Kind == BlockKind.BulletList ? "ul" : "ol";
                    builder.Append('<').Append(tag).Append('>');
                    foreach (var item in block.Items ?? [])
                    {
                        builder.Append("<li><p>").Append(RenderInlineHtml(item)).Append("</p></li>");
                    }
                    builder.Append("</").Append(tag).Append('>');
                    break;
                case BlockKind.Image when block.Image is not null:
                    builder.Append("<img src=\"")
                        .Append(WebUtility.HtmlEncode($"https://lightnote.attachments/{block.Image.RelativePath.Replace('\\', '/')}")).Append("\" alt=\"")
                        .Append(WebUtility.HtmlEncode(block.Text)).Append("\" data-attachment-id=\"")
                        .Append(WebUtility.HtmlEncode(block.Image.Id)).Append("\" width=\"")
                        .Append(block.Image.Width).Append("\" height=\"")
                        .Append(block.Image.Height).Append("\">");
                    break;
                default:
                    builder.Append("<p>").Append(RenderInlineHtml(block.Text)).Append("</p>");
                    break;
            }
        }
        return builder.ToString();
    }

    private static string RenderInlineHtml(string text)
    {
        var lines = NormalizeLineEndings(text).Split('\n');
        return string.Join("<br>", lines.Select(line => string.Concat(ParseInline(line).Select(segment =>
        {
            var encoded = WebUtility.HtmlEncode(segment.Text);
            return segment.Mark switch
            {
                "bold" => $"<strong>{encoded}</strong>",
                "italic" => $"<em>{encoded}</em>",
                "code" => $"<code>{encoded}</code>",
                _ => encoded,
            };
        }))));
    }

    private static IReadOnlyList<InlineSegment> ParseInline(string text)
    {
        var segments = new List<InlineSegment>();
        var cursor = 0;
        foreach (Match match in InlinePattern.Matches(text))
        {
            if (match.Index > cursor)
            {
                segments.Add(new InlineSegment(text[cursor..match.Index]));
            }

            if (match.Groups["code"].Success)
            {
                segments.Add(new InlineSegment(match.Value[1..^1], "code"));
            }
            else if (match.Groups["bold"].Success)
            {
                segments.Add(new InlineSegment(match.Value[2..^2], "bold"));
            }
            else
            {
                segments.Add(new InlineSegment(match.Value[1..^1], "italic"));
            }
            cursor = match.Index + match.Length;
        }

        if (cursor < text.Length)
        {
            segments.Add(new InlineSegment(text[cursor..]));
        }
        if (segments.Count == 0 && text.Length > 0)
        {
            segments.Add(new InlineSegment(text));
        }
        return segments;
    }

    private static string BuildText(IReadOnlyList<ImportedBlock> blocks) => string.Join(
        Environment.NewLine,
        blocks.Select(block => block.Kind == BlockKind.Image
            ? string.IsNullOrWhiteSpace(block.Text) ? "[图片]" : $"[图片：{block.Text}]"
            : block.Items is { Count: > 0 }
            ? string.Join(Environment.NewLine, block.Items)
            : block.Text));

    private static string NormalizeLineEndings(string value) =>
        value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');

    private enum BlockKind
    {
        Paragraph,
        Heading,
        BulletList,
        OrderedList,
        Quote,
        Code,
        Image,
    }

    private sealed record ImportedBlock(
        BlockKind Kind,
        string Text,
        int Level = 0,
        IReadOnlyList<string>? Items = null,
        AttachmentImportResult? Image = null);

    private sealed record ImportedDocument(
        string? Title,
        IReadOnlyList<ImportedBlock> Blocks,
        DateTimeOffset? CreatedAt = null,
        DateTimeOffset? UpdatedAt = null,
        bool IsPinned = false,
        IReadOnlyList<string>? Tags = null,
        IReadOnlyList<ImportedAttachment>? Attachments = null);

    private sealed record ImportedAttachment(
        string FileName,
        string MimeType,
        byte[] Content,
        string Alt);

    private sealed record InlineSegment(string Text, string? Mark = null);
}

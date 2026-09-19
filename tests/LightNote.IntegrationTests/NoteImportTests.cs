using System.Text.Json;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class NoteImportTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Import.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task MarkdownImportPreservesBlocksInlineMarksAndRelativeFolder()
    {
        var (repository, service, notebooks, _) = await CreateServicesAsync();
        var now = DateTimeOffset.UtcNow;
        await notebooks.UpsertAsync(new Notebook
        {
            Id = "notebook-1",
            Name = "Imports",
            CreatedAt = now,
            UpdatedAt = now,
        });
        var sourceRoot = Path.Combine(_testDirectory, "source");
        var sourceDirectory = Path.Combine(sourceRoot, "projects");
        Directory.CreateDirectory(sourceDirectory);
        var sourcePath = Path.Combine(sourceDirectory, "release.md");
        var imagePath = Path.Combine(sourceDirectory, "pixel.png");
        await File.WriteAllBytesAsync(imagePath, Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="));
        await File.WriteAllTextAsync(sourcePath, """
            # Release notes

            Text with **bold**, *italic* and `code`.

            - first
            - second

            > quoted line

            ```
            var answer = 42;
            ```

            ![像素图](pixel.png)
            """);

        var result = await service.ImportAsync(new NoteImportRequest
        {
            SourcePaths = [sourcePath],
            NotebookId = "notebook-1",
            SourceRoot = sourceRoot,
            PrefixRelativeDirectory = true,
        });

        Assert.Equal(1, result.ImportedCount);
        Assert.Empty(result.Failures);
        var note = await repository.GetAsync(result.ImportedNoteIds.Single());
        Assert.NotNull(note);
        Assert.Equal("projects / release", note.Title);
        Assert.Equal("notebook-1", note.NotebookId);
        Assert.Contains("<h1>Release notes</h1>", note.BodyHtml);
        Assert.Contains("<strong>bold</strong>", note.BodyHtml);
        Assert.Contains("<ul>", note.BodyHtml);
        Assert.Contains("<blockquote>", note.BodyHtml);
        Assert.Contains("<pre><code>var answer = 42;", note.BodyHtml);
        Assert.Contains("https://lightnote.attachments/", note.BodyHtml);
        Assert.Contains("data-attachment-id=", note.BodyHtml);
        Assert.Empty(result.Warnings);

        using var document = JsonDocument.Parse(note.BodyJson);
        var nodeTypes = document.RootElement.GetProperty("content")
            .EnumerateArray()
            .Select(node => node.GetProperty("type").GetString())
            .ToArray();
        Assert.Contains("heading", nodeTypes);
        Assert.Contains("bulletList", nodeTypes);
        Assert.Contains("blockquote", nodeTypes);
        Assert.Contains("codeBlock", nodeTypes);
        Assert.Contains("\"type\":\"bold\"", note.BodyJson);
    }

    [Fact]
    public async Task HtmlImportRemovesExecutableMarkupAndReportsImageWarning()
    {
        var (repository, service, _, _) = await CreateServicesAsync();
        var sourcePath = Path.Combine(_testDirectory, "page.html");
        await File.WriteAllTextAsync(sourcePath,
            "<h1>Visible</h1><script>alert('bad')</script><p>Hello &amp; goodbye</p><img src='remote.png'>");

        var result = await service.ImportAsync(new NoteImportRequest { SourcePaths = [sourcePath] });

        var note = await repository.GetAsync(result.ImportedNoteIds.Single());
        Assert.NotNull(note);
        Assert.DoesNotContain("alert", note.BodyText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Visible", note.BodyText);
        Assert.Contains("Hello & goodbye", note.BodyText);
        Assert.Contains("[图片]", note.BodyText);
        Assert.Single(result.Warnings);
    }

    [Fact]
    public async Task HtmlImportCopiesLocalImagesIntoAttachmentStore()
    {
        var (repository, service, _, _) = await CreateServicesAsync();
        var imagePath = Path.Combine(_testDirectory, "html-pixel.png");
        await File.WriteAllBytesAsync(imagePath, Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="));
        var sourcePath = Path.Combine(_testDirectory, "with-image.html");
        await File.WriteAllTextAsync(sourcePath, "<h1>图文</h1><p>正文</p><img src='html-pixel.png'>");

        var result = await service.ImportAsync(new NoteImportRequest { SourcePaths = [sourcePath] });

        var note = await repository.GetAsync(result.ImportedNoteIds.Single());
        Assert.NotNull(note);
        Assert.Contains("https://lightnote.attachments/", note.BodyHtml);
        Assert.DoesNotContain("[图片]", note.BodyText);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public async Task BatchImportKeepsSuccessfulFilesWhenAnotherFileFails()
    {
        var (_, service, _, _) = await CreateServicesAsync();
        var textPath = Path.Combine(_testDirectory, "good.txt");
        var unsupportedPath = Path.Combine(_testDirectory, "bad.pdf");
        var brokenJsonPath = Path.Combine(_testDirectory, "broken.json");
        await File.WriteAllTextAsync(textPath, "A useful note.");
        await File.WriteAllTextAsync(unsupportedPath, "not really a PDF");
        await File.WriteAllTextAsync(brokenJsonPath, "{ definitely not JSON }");

        var result = await service.ImportAsync(new NoteImportRequest
        {
            SourcePaths = [textPath, unsupportedPath, brokenJsonPath, Path.Combine(_testDirectory, "missing.md")],
        });

        Assert.Equal(1, result.ImportedCount);
        Assert.Equal(3, result.FailedCount);
        Assert.Contains(result.Failures, failure => failure.SourcePath == unsupportedPath);
        Assert.Contains(result.Failures, failure => failure.SourcePath == brokenJsonPath);
    }

    [Fact]
    public async Task LegacyChineseTextEncodingIsDetectedAndReported()
    {
        var (repository, service, _, _) = await CreateServicesAsync();
        var sourcePath = Path.Combine(_testDirectory, "legacy.txt");
        System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
        await File.WriteAllBytesAsync(sourcePath, System.Text.Encoding.GetEncoding(936).GetBytes("旧版中文笔记"));

        var result = await service.ImportAsync(new NoteImportRequest { SourcePaths = [sourcePath] });

        var note = await repository.GetAsync(result.ImportedNoteIds.Single());
        Assert.Equal("旧版中文笔记", note?.BodyText);
        Assert.Single(result.Warnings);
        Assert.Contains("不是 UTF-8", result.Warnings[0]);
    }

    [Fact]
    public async Task EnexImportCreatesEveryNoteAndPreservesMetadata()
    {
        var (repository, service, _, tags) = await CreateServicesAsync();
        var sourcePath = Path.Combine(_testDirectory, "evernote.enex");
        await File.WriteAllTextAsync(sourcePath, """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
            <en-export>
              <note>
                <title>第一篇</title>
                <content><![CDATA[<?xml version="1.0"?><en-note><div>正文一</div><en-media type="image/png" hash="abc"/></en-note>]]></content>
                <created>20240102T030405Z</created>
                <updated>20240203T040506Z</updated>
                <tag>工作</tag>
              </note>
              <note>
                <title>Second</title>
                <content><![CDATA[<en-note>Body two</en-note>]]></content>
              </note>
            </en-export>
            """);

        var result = await service.ImportAsync(new NoteImportRequest { SourcePaths = [sourcePath] });

        Assert.Equal(2, result.ImportedCount);
        Assert.Empty(result.Failures);
        var notes = await Task.WhenAll(result.ImportedNoteIds.Select(id => repository.GetAsync(id)));
        var first = Assert.Single(notes, note => note?.Title == "第一篇");
        Assert.NotNull(first);
        Assert.Contains("正文一", first.BodyText);
        Assert.Contains("[附件或图片]", first.BodyText);
        Assert.Contains(await tags.ListForNoteAsync(first.Id), tag => tag.Name == "工作");
        Assert.Equal(2024, first.CreatedAt.Year);
        Assert.Contains(result.Warnings, warning => warning.Contains("不受支持的附件"));
    }

    [Fact]
    public async Task GoogleKeepJsonImportPreservesChecklistLabelsPinnedAndTimestamps()
    {
        var (repository, service, _, tags) = await CreateServicesAsync();
        var sourcePath = Path.Combine(_testDirectory, "shopping.json");
        await File.WriteAllTextAsync(sourcePath, """
            {
              "title": "采购清单",
              "listContent": [
                { "text": "牛奶", "isChecked": true },
                { "text": "咖啡", "isChecked": false }
              ],
              "labels": [{ "name": "生活" }],
              "isPinned": true,
              "createdTimestampUsec": "1704164645000000",
              "userEditedTimestampUsec": "1706933106000000"
            }
            """);

        var result = await service.ImportAsync(new NoteImportRequest { SourcePaths = [sourcePath] });

        var note = await repository.GetAsync(result.ImportedNoteIds.Single());
        Assert.NotNull(note);
        Assert.Equal("采购清单", note.Title);
        Assert.True(note.IsPinned);
        Assert.Contains("☑ 牛奶", note.BodyText);
        Assert.Contains("☐ 咖啡", note.BodyText);
        Assert.Contains(await tags.ListForNoteAsync(note.Id), tag => tag.Name == "生活");
        Assert.Equal(2024, note.CreatedAt.Year);
    }

    [Fact]
    public async Task CsvImportSupportsMultipleRowsQuotedNewlinesAndChineseHeaders()
    {
        var (repository, service, _, tags) = await CreateServicesAsync();
        var sourcePath = Path.Combine(_testDirectory, "memos.csv");
        await File.WriteAllTextAsync(sourcePath, """
            标题,内容,创建时间,标签
            灵感,"第一行
            第二行",2024-01-02 03:04:05,#想法
            ,另一条,2024-02-03 04:05:06,
            """);

        var result = await service.ImportAsync(new NoteImportRequest { SourcePaths = [sourcePath] });

        Assert.Equal(2, result.ImportedCount);
        var notes = await Task.WhenAll(result.ImportedNoteIds.Select(id => repository.GetAsync(id)));
        var titled = Assert.Single(notes, note => note?.Title == "灵感");
        Assert.NotNull(titled);
        Assert.Contains("第一行", titled.BodyText);
        Assert.Contains("第二行", titled.BodyText);
        Assert.Contains(await tags.ListForNoteAsync(titled.Id), tag => tag.Name == "想法");
    }

    [Fact]
    public async Task MultiArticleHtmlImportCreatesSeparateNotes()
    {
        var (repository, service, _, _) = await CreateServicesAsync();
        var sourcePath = Path.Combine(_testDirectory, "flomo.html");
        await File.WriteAllTextAsync(sourcePath, """
            <html><body>
              <article><h2>卡片一</h2><p>第一条内容</p><time datetime="2024-01-02T03:04:05+08:00"></time></article>
              <article><p>没有标题的第二条内容</p></article>
            </body></html>
            """);

        var result = await service.ImportAsync(new NoteImportRequest { SourcePaths = [sourcePath] });

        Assert.Equal(2, result.ImportedCount);
        var notes = await Task.WhenAll(result.ImportedNoteIds.Select(id => repository.GetAsync(id)));
        Assert.Contains(notes, note => note?.Title == "卡片一" && note.BodyText.Contains("第一条内容"));
        Assert.Contains(notes, note => note?.BodyText.Contains("第二条内容") == true);
    }

    [Fact]
    public async Task LightNoteExportsCanBeImportedAgain()
    {
        var (repository, service, _, _) = await CreateServicesAsync();
        var paths = new AppDataPaths(Path.Combine(_testDirectory, "export-data"));
        var exporter = new NoteExportService(paths);
        var now = DateTimeOffset.UtcNow;
        var source = new Note
        {
            Id = "round-trip-source",
            Title = "往返迁移",
            BodyJson = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"重要正文\"}]}]}",
            BodyHtml = "<p>重要正文</p>",
            BodyText = "重要正文",
            CreatedAt = now,
            UpdatedAt = now,
        };
        var htmlPath = Path.Combine(_testDirectory, "renamed.html");
        var markdownPath = Path.Combine(_testDirectory, "往返迁移.md");
        var textPath = Path.Combine(_testDirectory, "往返迁移.txt");
        await exporter.ExportAsync(source, NoteExportFormat.Html, htmlPath);
        await exporter.ExportAsync(source, NoteExportFormat.Markdown, markdownPath);
        await exporter.ExportAsync(source, NoteExportFormat.PlainText, textPath);

        var result = await service.ImportAsync(new NoteImportRequest
        {
            SourcePaths = [htmlPath, markdownPath, textPath],
        });

        Assert.Equal(3, result.ImportedCount);
        var notes = await Task.WhenAll(result.ImportedNoteIds.Select(id => repository.GetAsync(id)));
        Assert.All(notes, note => Assert.Contains("重要正文", note?.BodyText));
        Assert.Contains(notes, note => note?.Title == "往返迁移");
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
    }

    private async Task<(
        INoteRepository Repository,
        INoteImportService Service,
        INotebookRepository Notebooks,
        ITagRepository Tags)> CreateServicesAsync()
    {
        var paths = new AppDataPaths(Path.Combine(_testDirectory, "data"));
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        var repository = new SqliteNoteRepository(factory);
        var tags = new SqliteTagRepository(factory);
        var attachments = new AttachmentService(paths, factory);
        return (
            repository,
            new NoteImportService(repository, tags, attachments),
            new SqliteNotebookRepository(factory),
            tags);
    }

    private sealed class NullLogger : IAppLogger
    {
        public void Info(string message)
        {
        }

        public void Error(string message, Exception exception)
        {
        }
    }
}

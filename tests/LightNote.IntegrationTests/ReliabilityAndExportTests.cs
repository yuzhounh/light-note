using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class ReliabilityAndExportTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Tests",
        Guid.NewGuid().ToString("N"));
    private readonly string _restoreDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Restore.Tests",
        Guid.NewGuid().ToString("N"));

    private static Note Edited(Note note, int version, TimeSpan after) => note with
    {
        Title = $"Version {version}",
        BodyJson = $"{{\"type\":\"doc\",\"version\":{version}}}",
        BodyHtml = $"<p>body {version}</p>",
        BodyText = $"body {version}",
        Version = version,
        UpdatedAt = note.UpdatedAt + after,
    };

    [Fact]
    public async Task RapidAutosavesProduceOnlyOneSnapshotPerEditingSession()
    {
        var (_, factory, notes) = await CreateServicesAsync();
        var history = new SqliteNoteHistoryRepository(factory);
        var note = CreateNote("Version 1", "body 1");
        await notes.UpsertAsync(note);

        // 连续输入：每次保存只隔 1 分钟，整个时段只应保存开始前的那一个版本
        for (var version = 2; version <= 9; version++)
        {
            note = Edited(note, version, TimeSpan.FromMinutes(1));
            await notes.UpsertAsync(note);
        }

        var versions = await history.ListAsync(note.Id);
        Assert.Single(versions);
        Assert.Equal("body 1", versions[0].BodyText);

        // 间隔超过 10 分钟后再次编辑，会再保存一个版本
        note = Edited(note, 10, TimeSpan.FromMinutes(15));
        await notes.UpsertAsync(note);
        Assert.Equal(2, (await history.ListAsync(note.Id)).Count);
    }

    [Fact]
    public async Task VersionsOlderThanTwoDaysAreThinnedToOnePerDay()
    {
        var (_, factory, notes) = await CreateServicesAsync();
        var history = new SqliteNoteHistoryRepository(factory);
        var note = CreateNote("Version 1", "body 1") with { UpdatedAt = DateTimeOffset.UtcNow.AddDays(-5) };
        await notes.UpsertAsync(note);

        // 五天前的一次连续编辑，产生 20 个相隔 11 分钟的版本；最多跨越两个 UTC 日期
        for (var version = 2; version <= 21; version++)
        {
            note = Edited(note, version, TimeSpan.FromMinutes(11));
            await notes.UpsertAsync(note);
        }

        var versions = await history.ListAsync(note.Id);
        Assert.InRange(versions.Count, 1, 2);
    }

    [Fact]
    public async Task HistoryKeepsLatestFiftySnapshotsAndCanRestoreContent()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var history = new SqliteNoteHistoryRepository(factory);
        var note = CreateNote("Version 1", "body 1");
        await notes.UpsertAsync(note);

        for (var version = 2; version <= 61; version++)
        {
            note = Edited(note, version, TimeSpan.FromMinutes(11));
            await notes.UpsertAsync(note);
        }

        var versions = await history.ListAsync(note.Id);

        Assert.Equal(50, versions.Count);
        Assert.Equal(60, versions[0].Version);
        Assert.Equal("body 60", versions[0].BodyText);
        Assert.Equal(11, versions[^1].Version);
        Assert.True(Directory.Exists(paths.RecoveryDirectory));

        var viewModel = new MainViewModel(
            notes,
            new SqliteNotebookRepository(factory),
            new NullLogger(),
            historyRepository: history);
        await viewModel.InitializeAsync();
        viewModel.SelectedNote = viewModel.Notes.Single(item => item.Model.Id == note.Id);
        await viewModel.RestoreVersionAsync(versions[^1].Id);

        var restored = await notes.GetAsync(note.Id);
        Assert.Equal("body 11", restored?.BodyText);
        Assert.Equal(62, restored?.Version);
    }

    [Fact]
    public async Task BackupRoundTripsDatabaseAndAttachmentsIntoEmptyDirectory()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Backup note", "has image");
        await notes.UpsertAsync(note);
        var attachments = new AttachmentService(paths, factory);
        var imported = await attachments.ImportAsync(
            note.Id,
            "pixel.png",
            "image/png",
            OnePixelPng);

        var backup = new BackupService(paths, factory);
        var archivePath = await backup.CreateAsync();
        await backup.RestoreAsync(archivePath, _restoreDirectory);

        var restoredPaths = new AppDataPaths(_restoreDirectory);
        var restoredNotes = new SqliteNoteRepository(new SqliteConnectionFactory(restoredPaths));
        Assert.Equal(note.Title, (await restoredNotes.GetAsync(note.Id))?.Title);
        Assert.True(File.Exists(Path.Combine(
            restoredPaths.AttachmentsDirectory,
            imported.RelativePath.Replace('/', Path.DirectorySeparatorChar))));
    }

    [Fact]
    public async Task ExportsHtmlPlainTextAndMarkdownWithLocalImage()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Export title", "Hello image");
        await notes.UpsertAsync(note);
        var imported = await new AttachmentService(paths, factory).ImportAsync(
            note.Id,
            "pixel.png",
            "image/png",
            OnePixelPng);
        var imageUrl = $"https://lightnote.attachments/{imported.RelativePath}";
        note = note with
        {
            BodyHtml = $"<p><strong>Hello</strong></p><img src=\"{imageUrl}\">",
            BodyJson = $$$"""
                {"type":"doc","content":[
                  {"type":"paragraph","content":[{"type":"text","text":"Hello","marks":[{"type":"bold"}]}]},
                  {"type":"paragraph","content":[{"type":"image","attrs":{"src":"{{{imageUrl}}}","alt":"pixel"}}]}
                ]}
                """,
        };
        var exporter = new NoteExportService(paths);
        var outputDirectory = Path.Combine(_testDirectory, "exports");
        var htmlPath = Path.Combine(outputDirectory, "note.html");
        var textPath = Path.Combine(outputDirectory, "note.txt");
        var markdownPath = Path.Combine(outputDirectory, "note.md");

        await exporter.ExportAsync(note, NoteExportFormat.Html, htmlPath);
        await exporter.ExportAsync(note, NoteExportFormat.PlainText, textPath);
        await exporter.ExportAsync(note, NoteExportFormat.Markdown, markdownPath);

        Assert.Contains("data:image/png;base64,", await File.ReadAllTextAsync(htmlPath));
        Assert.Contains("Export title", await File.ReadAllTextAsync(textPath));
        var markdown = await File.ReadAllTextAsync(markdownPath);
        Assert.Contains("**Hello**", markdown);
        Assert.Contains("![pixel](note_files/", markdown);
        Assert.True(Directory.EnumerateFiles(Path.Combine(outputDirectory, "note_files")).Any());
    }

    [Fact]
    public async Task ExportsMathFormulasToMarkdownAndHtml()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Math Note", "E=mc^2");
        note = note with
        {
            BodyHtml = "<p>Formula: <span data-type=\"inline-math\" data-latex=\"\\rightarrow\"></span></p><div data-type=\"block-math\" data-latex=\"\\sum_{i=1}^n x_i\"></div>",
            BodyJson = """
                {"type":"doc","content":[
                  {"type":"paragraph","content":[
                    {"type":"text","text":"Formula: "},
                    {"type":"inlineMath","attrs":{"latex":"\\rightarrow"}}
                  ]},
                  {"type":"blockMath","attrs":{"latex":"\\sum_{i=1}^n x_i"}}
                ]}
                """,
        };
        var exporter = new NoteExportService(paths);
        var outputDirectory = Path.Combine(_testDirectory, "math_exports");
        var htmlPath = Path.Combine(outputDirectory, "math.html");
        var markdownPath = Path.Combine(outputDirectory, "math.md");

        await exporter.ExportAsync(note, NoteExportFormat.Html, htmlPath);
        await exporter.ExportAsync(note, NoteExportFormat.Markdown, markdownPath);

        var markdown = await File.ReadAllTextAsync(markdownPath);
        Assert.Contains(@"$\rightarrow$", markdown);
        Assert.Contains(@"$$\sum_{i=1}^n x_i$$".Replace("$$", "$$\r\n").Replace(@"\sum_{i=1}^n x_i", @"\sum_{i=1}^n x_i" + "\r\n"), markdown);

        var html = await File.ReadAllTextAsync(htmlPath);
        Assert.Contains("katex", html);
    }

    [Fact]
    public async Task RecoveryReplaysNewerDraftAndIntegrityReportsMissingAttachment()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Stored", "old");
        await notes.UpsertAsync(note);
        var recovery = new RecoveryService(paths, notes, new NullLogger());
        recovery.SaveDraft(note with
        {
            Title = "Recovered",
            BodyText = "new",
            BodyHtml = "<p>new</p>",
            Version = 2,
            UpdatedAt = note.UpdatedAt.AddMinutes(1),
        });

        Assert.Equal(1, await recovery.RecoverAsync());
        Assert.Equal("Recovered", (await notes.GetAsync(note.Id))?.Title);
        Assert.Empty(Directory.EnumerateFiles(paths.RecoveryDirectory, "*.json"));

        var imported = await new AttachmentService(paths, factory).ImportAsync(
            note.Id,
            "pixel.png",
            "image/png",
            OnePixelPng);
        File.Delete(Path.Combine(
            paths.AttachmentsDirectory,
            imported.RelativePath.Replace('/', Path.DirectorySeparatorChar)));
        var result = await new DatabaseIntegrityChecker(paths, factory).CheckAsync();
        Assert.True(result.IsHealthy);
        Assert.Contains(result.Warnings, warning => warning.Contains(imported.Id, StringComparison.Ordinal));
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }

        if (Directory.Exists(_restoreDirectory))
        {
            Directory.Delete(_restoreDirectory, recursive: true);
        }
    }

    private async Task<(AppDataPaths Paths, SqliteConnectionFactory Factory, INoteRepository Notes)>
        CreateServicesAsync()
    {
        var paths = new AppDataPaths(_testDirectory);
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        return (paths, factory, new SqliteNoteRepository(factory));
    }

    private static Note CreateNote(string title, string body) => new()
    {
        Id = Guid.NewGuid().ToString(),
        Title = title,
        BodyJson = "{\"type\":\"doc\"}",
        BodyHtml = $"<p>{body}</p>",
        BodyText = body,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private static byte[] OnePixelPng => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQ0T8AAAAASUVORK5CYII=");

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

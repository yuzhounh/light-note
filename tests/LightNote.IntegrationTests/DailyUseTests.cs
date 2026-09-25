using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;

namespace LightNote.IntegrationTests;

public sealed class DailyUseTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.DailyUse.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public void NotePreviewCollapsesBlankLinesAndWhitespace()
    {
        var now = DateTimeOffset.UtcNow;
        var item = new NoteListItem(new Note
        {
            Id = "preview-note",
            Title = "预览",
            BodyJson = "{}",
            BodyHtml = "",
            BodyText = "第一行\n\n第二行\r\n   第三行",
            CreatedAt = now,
            UpdatedAt = now,
        });

        Assert.Equal("第一行 第二行 第三行", item.Preview);
    }

    [Fact]
    public void SettingsRoundTripAndInvalidValuesAreNormalized()
    {
        var paths = new AppDataPaths(_testDirectory);
        var service = new AppSettingsService(paths);
        service.Save(new AppSettings
        {
            WindowWidth = 50,
            WindowHeight = 10_000,
            NotebookPaneWidth = 900,
            Theme = "unknown",
            ShowRecentNavigation = true,
            BackupRetentionCount = 500,
        });

        var loaded = service.Load();

        Assert.Equal(900, loaded.WindowWidth);
        Assert.Equal(4320, loaded.WindowHeight);
        Assert.Equal(600, loaded.NotebookPaneWidth);
        Assert.Equal("system", loaded.Theme);
        Assert.True(loaded.ShowRecentNavigation);
        Assert.Equal(100, loaded.BackupRetentionCount);
    }

    [Fact]
    public void CorruptSettingsFallBackToDefaults()
    {
        var paths = new AppDataPaths(_testDirectory);
        paths.EnsureCreated();
        File.WriteAllText(paths.SettingsPath, "{not-json");

        var loaded = new AppSettingsService(paths).Load();

        Assert.Equal("system", loaded.Theme);
        Assert.Equal(1180, loaded.WindowWidth);
        Assert.True(loaded.AutomaticBackups);
    }

    [Fact]
    public async Task MigrationChoosesLegacyDatabaseWithMostNotes()
    {
        var smallRoot = Path.Combine(_testDirectory, "legacy-small");
        var richRoot = Path.Combine(_testDirectory, "legacy-rich");
        var destinationRoot = Path.Combine(_testDirectory, "stable");
        await SeedNotesAsync(smallRoot, 1);
        await SeedNotesAsync(richRoot, 3);

        var result = AppDataMigrator.MigrateIfNeeded(destinationRoot, [smallRoot, richRoot]);

        Assert.NotNull(result);
        Assert.Equal(Path.GetFullPath(richRoot), result.SourceDirectory);
        Assert.Equal(3, result.NoteCount);
        var destinationPaths = new AppDataPaths(destinationRoot);
        var destinationNotes = new SqliteNoteRepository(new SqliteConnectionFactory(destinationPaths));
        Assert.Equal(3, (await destinationNotes.ListAsync(null, true, false)).Count);
        Assert.True(File.Exists(Path.Combine(destinationRoot, "settings.json")));
    }

    [Fact]
    public async Task AutomaticBackupRunsDailyAndEnforcesRetention()
    {
        var paths = new AppDataPaths(_testDirectory);
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        var settingsService = new AppSettingsService(paths);
        settingsService.Save(new AppSettings { BackupRetentionCount = 2 });
        var service = new AutomaticBackupService(
            paths,
            new BackupService(paths, factory),
            settingsService);

        var first = await service.RunIfDueAsync();
        Assert.NotNull(first);
        Assert.Null(await service.RunIfDueAsync());
        File.SetCreationTimeUtc(first!, DateTime.UtcNow.AddDays(-3));

        var second = await service.RunIfDueAsync();
        Assert.NotNull(second);
        File.SetCreationTimeUtc(second!, DateTime.UtcNow.AddDays(-2));

        var third = await service.RunIfDueAsync();
        Assert.NotNull(third);
        Assert.Equal(2, Directory.EnumerateFiles(paths.BackupsDirectory, "LightNote-auto-*.zip").Count());
        Assert.False(File.Exists(first));
    }

    [Fact]
    public void TitleBoxHandlesTabAndEnterKeys()
    {
        var thread = new System.Threading.Thread(() =>
        {
            var textBox = new System.Windows.Controls.TextBox();
            var handledCount = 0;
            textBox.PreviewKeyDown += (sender, e) =>
            {
                if (e.Key == System.Windows.Input.Key.ImeProcessed)
                {
                    return;
                }

                if ((e.Key == System.Windows.Input.Key.Tab && System.Windows.Input.Keyboard.Modifiers == System.Windows.Input.ModifierKeys.None) ||
                    e.Key == System.Windows.Input.Key.Enter)
                {
                    e.Handled = true;
                    handledCount++;
                }
            };

            var source = new System.Windows.Interop.HwndSource(0, 0, 0, 0, 0, "test", IntPtr.Zero);
            try
            {
                var tabEvent = new System.Windows.Input.KeyEventArgs(
                    System.Windows.Input.Keyboard.PrimaryDevice,
                    source,
                    0,
                    System.Windows.Input.Key.Tab)
                {
                    RoutedEvent = System.Windows.UIElement.PreviewKeyDownEvent,
                };
                textBox.RaiseEvent(tabEvent);
                Assert.True(tabEvent.Handled);
                Assert.Equal(1, handledCount);

                var enterEvent = new System.Windows.Input.KeyEventArgs(
                    System.Windows.Input.Keyboard.PrimaryDevice,
                    source,
                    0,
                    System.Windows.Input.Key.Enter)
                {
                    RoutedEvent = System.Windows.UIElement.PreviewKeyDownEvent,
                };
                textBox.RaiseEvent(enterEvent);
                Assert.True(enterEvent.Handled);
                Assert.Equal(2, handledCount);

                var imeEvent = new System.Windows.Input.KeyEventArgs(
                    System.Windows.Input.Keyboard.PrimaryDevice,
                    source,
                    0,
                    System.Windows.Input.Key.ImeProcessed)
                {
                    RoutedEvent = System.Windows.UIElement.PreviewKeyDownEvent,
                };
                textBox.RaiseEvent(imeEvent);
                Assert.False(imeEvent.Handled);
                Assert.Equal(2, handledCount);
            }
            finally
            {
                source.Dispose();
            }
        });
        thread.SetApartmentState(System.Threading.ApartmentState.STA);
        thread.Start();
        thread.Join();
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
    }

    private static async Task SeedNotesAsync(string rootDirectory, int count)
    {
        var paths = new AppDataPaths(rootDirectory);
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        var notes = new SqliteNoteRepository(factory);
        for (var index = 0; index < count; index++)
        {
            var now = DateTimeOffset.UtcNow.AddMinutes(index);
            await notes.UpsertAsync(new Note
            {
                Id = Guid.NewGuid().ToString(),
                Title = $"Legacy {index}",
                BodyJson = "{\"type\":\"doc\"}",
                BodyHtml = $"<p>{index}</p>",
                BodyText = index.ToString(),
                CreatedAt = now,
                UpdatedAt = now,
            });
        }

        File.WriteAllText(paths.SettingsPath, "{}");
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

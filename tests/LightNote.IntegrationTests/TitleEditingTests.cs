using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;
using LightNote.Infrastructure.Sync;

namespace LightNote.IntegrationTests;

public sealed class TitleEditingTests
{
    public void RefreshAndSavePreserveTheTitleTextAndCaret()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            var directory = Path.Combine(Path.GetTempPath(), "LightNote.Title.Tests", Guid.NewGuid().ToString("N"));
            MainWindow? window = null;
            try
            {
                var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                app.InitializeComponent();
                var paths = new AppDataPaths(directory);
                var factory = new SqliteConnectionFactory(paths);
                var logger = new NullLogger();
                new SqliteDatabaseInitializer(factory, logger).InitializeAsync().GetAwaiter().GetResult();
                var notes = new SqliteNoteRepository(factory);
                var notebooks = new SqliteNotebookRepository(factory);
                var now = DateTimeOffset.UtcNow;
                var note = new Note { Id = "title-edit", Title = "原始标题", BodyHtml = "<p></p>",
                    BodyText = "", BodyJson = "{\"type\":\"doc\",\"content\":[]}", CreatedAt = now, UpdatedAt = now };
                notes.UpsertAsync(note).GetAwaiter().GetResult();
                notes.UpsertAsync(note with { Id = "another-note", Title = "另一篇", CreatedAt = now.AddSeconds(-1), UpdatedAt = now.AddSeconds(-1) })
                    .GetAwaiter().GetResult();
                using var http = new HttpClient();
                var vm = new MainViewModel(notes, notebooks, logger);
                window = new MainWindow(vm, paths, logger, null!, null!, factory, null!, null!, null!,
                    new FirebaseSyncService(paths, factory, http, logger), new AppSettingsService(paths), new ThemeService());
                vm.InitializeAsync().GetAwaiter().GetResult();
                vm.SelectedNote = vm.Notes.Single(item => item.Model.Id == note.Id);
                var root = (FrameworkElement)window.Content;
                window.Content = null;
                root.DataContext = vm;
                using var host = new HwndSource(new HwndSourceParameters("LightNote title test")
                    { Width = 1180, Height = 760, WindowStyle = unchecked((int)0x80000000) });
                host.RootVisual = root;
                root.Measure(new Size(1180, 760));
                root.Arrange(new Rect(0, 0, 1180, 760));
                root.UpdateLayout();
                var title = (TextBox)window.FindName("TitleBox");
                title.Text = "正在编辑的标题 ";
                title.Select(2, 1);
                var selected = vm.SelectedNote;
                var unexpectedClears = 0;
                title.TextChanged += (_, _) => { if (title.Text.Length == 0) unexpectedClears++; };
                vm.ChangeNoteSortAsync(byUpdated: true, descending: true).GetAwaiter().GetResult();
                Drain();
                Assert.Equal(0, unexpectedClears);
                Assert.Equal("正在编辑的标题 ", title.Text);
                Assert.Equal(2, title.SelectionStart);
                Assert.Equal(1, title.SelectionLength);
                Assert.Same(selected, vm.SelectedNote);

                title.Text = "";
                vm.FlushAllAsync().GetAwaiter().GetResult();
                vm.ChangeNoteSortAsync(byUpdated: false, descending: false).GetAwaiter().GetResult();
                Drain();
                Assert.Equal("", title.Text);
                title.Text = "最终新标题";
                title.Select(3, 0);
                Assert.True(vm.FlushAllAsync().GetAwaiter().GetResult());
                vm.RefreshAfterSyncAsync().GetAwaiter().GetResult();
                Drain();
                Assert.Equal("最终新标题", title.Text);
                Assert.Equal(3, title.CaretIndex);
                Assert.Equal("最终新标题", notes.GetAsync(note.Id).GetAwaiter().GetResult()?.Title);
                vm.SelectedNote = vm.Notes.Single(item => item.Model.Id == "another-note");
                Drain();
                Assert.Equal("另一篇", title.Text);
                vm.SelectedNote = vm.Notes.Single(item => item.Model.Id == note.Id);
                Drain();
                Assert.Equal("最终新标题", title.Text);
            }
            catch (Exception exception) { failure = exception; }
            finally
            {
                if (window is not null)
                {
                    typeof(MainWindow).GetField("_allowClose", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!.SetValue(window, true);
                    window.Close();
                }
                Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
                if (Directory.Exists(directory)) Directory.Delete(directory, true);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(20)), "Title editing test timed out.");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private static void Drain() => Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
    private sealed class NullLogger : IAppLogger
    {
        public void Info(string message) { }
        public void Error(string message, Exception exception) { }
    }
}

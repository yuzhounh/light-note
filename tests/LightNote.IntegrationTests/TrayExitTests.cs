using System.Windows;
using System.Windows.Threading;
using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;
using LightNote.Infrastructure.Sync;

namespace LightNote.IntegrationTests;

/// <summary>
/// 回归：托盘启动、从未显示过的实例退出时必须真的关掉。
/// 旧实现在 Closing 回调内直接 Close()，两个 await 同步返回时窗口仍处于“正在关闭”状态，
/// VerifyNotClosing 抛 InvalidOperationException，退出失败并弹“退出前保存失败”。
/// </summary>
public sealed class TrayExitTests
{
    public void ExitingTrayInstanceClosesWithoutSaveFailure()
    {
        Exception? failure = null;
        var closed = false;
        var errors = new List<string>();
        var thread = new Thread(() =>
        {
            var dispatcher = Dispatcher.CurrentDispatcher;
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(dispatcher));
            var directory = Path.Combine(Path.GetTempPath(), "LightNote.TrayExit.Tests", Guid.NewGuid().ToString("N"));
            MainWindow? window = null;
            dispatcher.BeginInvoke(new Action(() =>
            {
                try
                {
                    var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                    app.InitializeComponent();
                    var paths = new AppDataPaths(directory);
                    var factory = new SqliteConnectionFactory(paths);
                    var logger = new RecordingLogger(errors);
                    new SqliteDatabaseInitializer(factory, logger).InitializeAsync().GetAwaiter().GetResult();
                    var notes = new SqliteNoteRepository(factory);
                    var now = DateTimeOffset.UtcNow;
                    notes.UpsertAsync(new Note
                    {
                        Id = "tray-exit", Title = "托盘退出", BodyHtml = "<p>内容</p>", BodyText = "内容",
                        BodyJson = "{\"type\":\"doc\",\"content\":[]}", CreatedAt = now, UpdatedAt = now,
                    }).GetAwaiter().GetResult();
                    using var http = new HttpClient();
                    var vm = new MainViewModel(notes, new SqliteNotebookRepository(factory), logger);
                    window = new MainWindow(vm, paths, logger, null!, null!, factory, null!, null!, null!,
                        new FirebaseSyncService(paths, factory, http, logger), new AppSettingsService(paths), new ThemeService());
                    vm.InitializeAsync().GetAwaiter().GetResult();
                    // 不调用 Show()：这就是内嵌编辑器从未初始化、两个 await 同步返回的场景。
                    window.Closed += (_, _) =>
                    {
                        closed = true;
                        dispatcher.BeginInvokeShutdown(DispatcherPriority.Background);
                    };
                    window.ExitApplication();
                }
                catch (Exception exception)
                {
                    failure = exception;
                    Dispatcher.CurrentDispatcher.BeginInvokeShutdown(DispatcherPriority.Background);
                }
            }));
            Dispatcher.Run();
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(40)), "退出被阻塞：窗口没有关闭，仍停在“退出前保存失败”的对话框里。");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
        Assert.Empty(errors);
        Assert.True(closed, "ExitApplication 之后窗口没有触发 Closed。");
    }

    private sealed class RecordingLogger(List<string> errors) : IAppLogger
    {
        public void Info(string message) { }

        public void Error(string message, Exception exception) =>
            errors.Add($"{message}: {exception.GetType().Name}: {exception.Message}");
    }
}

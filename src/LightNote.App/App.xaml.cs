using System.Configuration;
using System.Data;
using System.Windows;
using System.Windows.Threading;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Logging;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;
using LightNote.Infrastructure.Sync;
using Microsoft.Extensions.DependencyInjection;

namespace LightNote.App;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : System.Windows.Application
{
    private ServiceProvider? _services;
    private SingleInstanceManager? _singleInstance;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _singleInstance = SingleInstanceManager.Acquire();
        if (!_singleInstance.IsPrimary)
        {
            await _singleInstance.NotifyPrimaryAsync();
            Shutdown();
            return;
        }

        _singleInstance.ActivationRequested += (_, _) => Dispatcher.BeginInvoke(() =>
        {
            if (MainWindow is MainWindow window)
            {
                window.ShowAndActivate();
            }
        });
        _singleInstance.StartListening();

        _services = ConfigureServices();
        var logger = _services.GetRequiredService<IAppLogger>();

        DispatcherUnhandledException += (_, args) => HandleDispatcherException(logger, args);
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception exception)
            {
                logger.Error("Unhandled application-domain exception.", exception);
            }
        };

        try
        {
            _services.GetRequiredService<AppDataPaths>().EnsureCreated();
            var settings = _services.GetRequiredService<AppSettingsService>().Load();
            _services.GetRequiredService<ThemeService>().Apply(settings.Theme);
            await _services.GetRequiredService<IDatabaseInitializer>().InitializeAsync();
            var integrity = await _services.GetRequiredService<IDatabaseIntegrityChecker>().CheckAsync();
            if (!integrity.IsHealthy)
            {
                throw new System.IO.InvalidDataException(string.Join(Environment.NewLine, integrity.Warnings));
            }

            foreach (var warning in integrity.Warnings)
            {
                logger.Info($"Startup integrity warning: {warning}");
            }

            var recoveredCount = await _services.GetRequiredService<IRecoveryService>().RecoverAsync();
            if (recoveredCount > 0)
            {
                logger.Info($"Recovered {recoveredCount} note draft(s).");
            }

            await _services.GetRequiredService<IAttachmentService>().PurgeExpiredAsync();
            await EnsureSmokeTestNoteAsync(_services.GetRequiredService<INoteRepository>());
            var automaticBackup = await _services.GetRequiredService<AutomaticBackupService>().RunIfDueAsync();
            if (automaticBackup is not null)
            {
                logger.Info($"Automatic backup created: {automaticBackup}");
            }

            var window = _services.GetRequiredService<MainWindow>();
            MainWindow = window;
            window.Show();
            logger.Info("LightNote started successfully.");
        }
        catch (Exception exception)
        {
            logger.Error("LightNote failed to start.", exception);
            MessageBox.Show(
                $"LightNote 无法启动。错误详情已写入日志。\n\n{exception.Message}",
                "LightNote",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(-1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _services?.GetService<IAppLogger>()?.Info("LightNote stopped.");
        _services?.Dispose();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }

    private static ServiceProvider ConfigureServices()
    {
        var services = new ServiceCollection();
        services.AddSingleton<AppDataPaths>();
        services.AddSingleton<AppSettingsService>();
        services.AddSingleton<ThemeService>();
        services.AddSingleton<StartupRegistrationService>();
        services.AddSingleton<IAppLogger, FileAppLogger>();
        services.AddSingleton<SqliteConnectionFactory>();
        services.AddSingleton<IDatabaseInitializer, SqliteDatabaseInitializer>();
        services.AddSingleton<INoteRepository, SqliteNoteRepository>();
        services.AddSingleton<INoteHistoryRepository, SqliteNoteHistoryRepository>();
        services.AddSingleton<INotebookRepository, SqliteNotebookRepository>();
        services.AddSingleton<ITagRepository, SqliteTagRepository>();
        services.AddSingleton<IAttachmentService, AttachmentService>();
        services.AddSingleton<BackupService>();
        services.AddSingleton<IBackupService>(provider => provider.GetRequiredService<BackupService>());
        services.AddSingleton<AutomaticBackupService>();
        services.AddSingleton<INoteExportService, NoteExportService>();
        services.AddSingleton<INoteImportService, NoteImportService>();
        services.AddSingleton<IRecoveryService, RecoveryService>();
        services.AddSingleton<IDatabaseIntegrityChecker, DatabaseIntegrityChecker>();
        services.AddSingleton(new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(30) });
        services.AddSingleton<IFirebaseSyncService, FirebaseSyncService>();
        services.AddTransient<MainViewModel>();
        services.AddTransient<MainWindow>();
        return services.BuildServiceProvider();
    }

    private static async Task EnsureSmokeTestNoteAsync(INoteRepository repository)
    {
        const string smokeTestId = "00000000-0000-0000-0000-000000000001";
        if (await repository.GetAsync(smokeTestId) is not null)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        await repository.UpsertAsync(new Note
        {
            Id = smokeTestId,
            Title = "欢迎使用 LightNote",
            BodyJson = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"这是 SQLite 与 WebView2 双向通信测试笔记。\"}]}]}",
            BodyHtml = "<p>这是 SQLite 与 WebView2 双向通信测试笔记。</p>",
            BodyText = "这是 SQLite 与 WebView2 双向通信测试笔记。",
            CreatedAt = now,
            UpdatedAt = now,
        });
    }

    private static void HandleDispatcherException(
        IAppLogger logger,
        DispatcherUnhandledExceptionEventArgs args)
    {
        logger.Error("Unhandled UI exception.", args.Exception);
        MessageBox.Show(
            "发生了未处理的界面错误，详情已写入日志。",
            "LightNote",
            MessageBoxButton.OK,
            MessageBoxImage.Error);
        args.Handled = true;
    }
}


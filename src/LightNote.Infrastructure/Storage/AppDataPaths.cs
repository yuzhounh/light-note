namespace LightNote.Infrastructure.Storage;

public sealed class AppDataPaths
{
    private readonly IReadOnlyList<string> _legacyDirectories;
    private readonly object _ensureGate = new();
    private bool _isCreated;

    public AppDataPaths(string? rootDirectory = null)
    {
        if (rootDirectory is not null)
        {
            RootDirectory = Path.GetFullPath(rootDirectory);
            _legacyDirectories = [];
            return;
        }

        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        RootDirectory = AppDataMigrator.GetStableRootDirectory(userProfile);
        _legacyDirectories = AppDataMigrator.DiscoverLegacyDirectories(userProfile);
    }

    public string RootDirectory { get; }

    public string? MigratedFromDirectory { get; private set; }

    public string DatabasePath => Path.Combine(RootDirectory, "lightnote.db");

    public string AttachmentsDirectory => Path.Combine(RootDirectory, "attachments");

    public string LogsDirectory => Path.Combine(RootDirectory, "logs");

    public string BackupsDirectory => Path.Combine(RootDirectory, "backups");

    public string RecoveryDirectory => Path.Combine(RootDirectory, "recovery");

    public string FirebaseConfigurationPath => Path.Combine(RootDirectory, "firebase.json");

    public string FirebaseSessionPath => Path.Combine(RootDirectory, "firebase-session.dat");

    public string SettingsPath => Path.Combine(RootDirectory, "settings.json");

    public string WebViewDataDirectory => Path.Combine(RootDirectory, "webview2");

    public void EnsureCreated()
    {
        lock (_ensureGate)
        {
            if (_isCreated)
            {
                return;
            }

            var migration = AppDataMigrator.MigrateIfNeeded(RootDirectory, _legacyDirectories);
            MigratedFromDirectory = migration?.SourceDirectory;

            Directory.CreateDirectory(RootDirectory);
            Directory.CreateDirectory(AttachmentsDirectory);
            Directory.CreateDirectory(LogsDirectory);
            Directory.CreateDirectory(BackupsDirectory);
            Directory.CreateDirectory(RecoveryDirectory);
            Directory.CreateDirectory(WebViewDataDirectory);
            _isCreated = true;
        }
    }
}

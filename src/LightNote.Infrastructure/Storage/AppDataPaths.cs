namespace LightNote.Infrastructure.Storage;

public sealed class AppDataPaths
{
    public AppDataPaths(string? rootDirectory = null)
    {
        RootDirectory = rootDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LightNote");
    }

    public string RootDirectory { get; }

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
        Directory.CreateDirectory(RootDirectory);
        Directory.CreateDirectory(AttachmentsDirectory);
        Directory.CreateDirectory(LogsDirectory);
        Directory.CreateDirectory(BackupsDirectory);
        Directory.CreateDirectory(RecoveryDirectory);
        Directory.CreateDirectory(WebViewDataDirectory);
    }
}

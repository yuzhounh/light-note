using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using LightNote.Infrastructure.Storage;

namespace LightNote.Infrastructure.Settings;

public sealed class AppSettingsService(AppDataPaths paths)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };
    private readonly object _gate = new();

    public AppSettings Load()
    {
        lock (_gate)
        {
            if (!File.Exists(paths.SettingsPath))
            {
                return new AppSettings();
            }

            try
            {
                var settings = JsonSerializer.Deserialize<AppSettings>(
                    File.ReadAllText(paths.SettingsPath),
                    JsonOptions) ?? new AppSettings();
                return settings with
                {
                    WindowWidth = Math.Clamp(settings.WindowWidth, 900, 7680),
                    WindowHeight = Math.Clamp(settings.WindowHeight, 560, 4320),
                    NotebookPaneWidth = Math.Clamp(settings.NotebookPaneWidth, 170, 600),
                    NoteListPaneWidth = Math.Clamp(settings.NoteListPaneWidth, 230, 800),
                    BackupRetentionCount = Math.Clamp(settings.BackupRetentionCount, 1, 100),
                    Theme = settings.Theme is "light" or "dark" or "system"
                        ? settings.Theme
                        : "system",
                    LinkOpenMode = settings.LinkOpenMode is "external"
                        ? "external"
                        : "internal",
                };
            }
            catch (JsonException)
            {
                return new AppSettings();
            }
        }
    }

    public void Save(AppSettings settings)
    {
        lock (_gate)
        {
            paths.EnsureCreated();
            var temporaryPath = $"{paths.SettingsPath}.{Guid.NewGuid():N}.tmp";
            try
            {
                File.WriteAllText(
                    temporaryPath,
                    JsonSerializer.Serialize(settings, JsonOptions),
                    new UTF8Encoding(false));
                File.Move(temporaryPath, paths.SettingsPath, overwrite: true);
            }
            finally
            {
                if (File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }
        }
    }
}

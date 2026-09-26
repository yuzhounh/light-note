using System.Text.Json;
using LightNote.Infrastructure.Storage;

namespace LightNote.Infrastructure.Sync;

internal sealed record FirebaseConfiguration
{
    public required string ProjectId { get; init; }

    public required string ApiKey { get; init; }

    public string? StorageBucket { get; init; }

    public string DatabaseId { get; init; } = "(default)";

    public string? GoogleClientId { get; init; }

    public string? GoogleClientSecret { get; init; }
}

internal sealed class FirebaseConfigurationProvider(AppDataPaths paths)
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public string ConfigurationPath => paths.FirebaseConfigurationPath;

    public bool IsConfigured
    {
        get
        {
            try
            {
                _ = Load();
                return true;
            }
            catch (Exception exception) when (
                exception is FileNotFoundException or InvalidDataException or JsonException)
            {
                return false;
            }
        }
    }

    public FirebaseConfiguration? LoadSafely()
    {
        try
        {
            return Load();
        }
        catch
        {
            return null;
        }
    }

    public FirebaseConfiguration Load()
    {
        if (!File.Exists(ConfigurationPath))
        {
            throw new FileNotFoundException("尚未提供 Firebase 配置文件。", ConfigurationPath);
        }

        var configuration = JsonSerializer.Deserialize<FirebaseConfiguration>(
            File.ReadAllText(ConfigurationPath),
            JsonOptions) ?? throw new InvalidDataException("Firebase 配置文件为空。");
        if (string.IsNullOrWhiteSpace(configuration.ProjectId) ||
            string.IsNullOrWhiteSpace(configuration.ApiKey))
        {
            throw new InvalidDataException("Firebase 配置必须包含 projectId 和 apiKey。");
        }

        return configuration;
    }

    public void SaveGoogleCredentials(string clientId, string? clientSecret)
    {
        if (!File.Exists(ConfigurationPath))
        {
            return;
        }

        try
        {
            var json = File.ReadAllText(ConfigurationPath);
            var doc = JsonSerializer.Deserialize<System.Text.Json.Nodes.JsonObject>(json, JsonOptions) ?? [];
            doc["googleClientId"] = clientId.Trim();
            if (!string.IsNullOrWhiteSpace(clientSecret))
            {
                doc["googleClientSecret"] = clientSecret.Trim();
            }
            File.WriteAllText(ConfigurationPath, doc.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Ignore errors when saving optional Google credentials to disk
        }
    }
}

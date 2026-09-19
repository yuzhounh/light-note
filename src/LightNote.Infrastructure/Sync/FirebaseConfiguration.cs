using System.Text.Json;
using LightNote.Infrastructure.Storage;

namespace LightNote.Infrastructure.Sync;

internal sealed record FirebaseConfiguration
{
    public required string ProjectId { get; init; }

    public required string ApiKey { get; init; }

    public required string StorageBucket { get; init; }

    public string DatabaseId { get; init; } = "(default)";
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
            string.IsNullOrWhiteSpace(configuration.ApiKey) ||
            string.IsNullOrWhiteSpace(configuration.StorageBucket))
        {
            throw new InvalidDataException("Firebase 配置必须包含 projectId、apiKey 和 storageBucket。");
        }

        return configuration;
    }
}

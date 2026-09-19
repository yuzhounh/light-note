using System.Globalization;
using LightNote.Core.Abstractions;
using LightNote.Infrastructure.Storage;

namespace LightNote.Infrastructure.Logging;

public sealed class FileAppLogger(AppDataPaths paths) : IAppLogger
{
    private readonly Lock _writeLock = new();

    public void Info(string message) => Write("INFO", message, null);

    public void Error(string message, Exception exception) => Write("ERROR", message, exception);

    private void Write(string level, string message, Exception? exception)
    {
        paths.EnsureCreated();
        var entry = $"{DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture)} [{level}] {message}";
        if (exception is not null)
        {
            entry += Environment.NewLine + exception;
        }

        lock (_writeLock)
        {
            File.AppendAllText(
                Path.Combine(paths.LogsDirectory, $"lightnote-{DateTime.UtcNow:yyyyMMdd}.log"),
                entry + Environment.NewLine);
        }
    }
}

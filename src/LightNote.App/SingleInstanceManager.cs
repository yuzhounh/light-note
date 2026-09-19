using System.IO;
using System.IO.Pipes;

namespace LightNote.App;

internal sealed class SingleInstanceManager : IDisposable
{
    private const string MutexName = "Local\\LightNote.Desktop.SingleInstance";
    private const string PipeName = "LightNote.Desktop.Activate";
    private readonly Mutex? _mutex;
    private readonly CancellationTokenSource _cancellation = new();

    private SingleInstanceManager(Mutex? mutex, bool isPrimary)
    {
        _mutex = mutex;
        IsPrimary = isPrimary;
    }

    public bool IsPrimary { get; }

    public event EventHandler? ActivationRequested;

    public static SingleInstanceManager Acquire()
    {
        var mutex = new Mutex(initiallyOwned: true, MutexName, out var createdNew);
        return createdNew
            ? new SingleInstanceManager(mutex, isPrimary: true)
            : new SingleInstanceManager(mutex, isPrimary: false);
    }

    public void StartListening()
    {
        if (IsPrimary)
        {
            _ = ListenAsync(_cancellation.Token);
        }
    }

    public async Task NotifyPrimaryAsync(CancellationToken cancellationToken = default)
    {
        if (IsPrimary)
        {
            return;
        }

        try
        {
            await using var client = new NamedPipeClientStream(
                ".",
                PipeName,
                PipeDirection.Out,
                PipeOptions.Asynchronous);
            await client.ConnectAsync(1500, cancellationToken);
            await client.WriteAsync("activate"u8.ToArray(), cancellationToken);
        }
        catch (Exception exception) when (
            exception is IOException or TimeoutException or OperationCanceledException)
        {
        }
    }

    public void Dispose()
    {
        _cancellation.Cancel();
        _cancellation.Dispose();
        if (IsPrimary)
        {
            try
            {
                _mutex?.ReleaseMutex();
            }
            catch (ApplicationException)
            {
            }
        }
        _mutex?.Dispose();
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.In,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);
                await server.WaitForConnectionAsync(cancellationToken);
                var buffer = new byte[16];
                if (await server.ReadAsync(buffer, cancellationToken) > 0)
                {
                    ActivationRequested?.Invoke(this, EventArgs.Empty);
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (IOException)
            {
            }
        }
    }
}

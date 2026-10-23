namespace LightNote.Core;

/// <summary>Shares work by key, bounds concurrent loaders and retains a small LRU.</summary>
public sealed class BoundedAsyncCache<T> where T : class
{
    private sealed record Entry(T? Value, DateTimeOffset? Expires, LinkedListNode<string> Node);
    private readonly object _gate = new();
    private readonly Dictionary<string, Entry> _items = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Task<T?>> _pending = new(StringComparer.OrdinalIgnoreCase);
    private readonly LinkedList<string> _order = new();
    private readonly SemaphoreSlim _slots;
    private readonly int _capacity;
    private readonly Func<DateTimeOffset> _clock;

    public BoundedAsyncCache(int capacity, int concurrency, Func<DateTimeOffset>? clock = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(concurrency);
        _capacity = capacity;
        _slots = new SemaphoreSlim(concurrency);
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    public bool TryGetValue(string key, out T? value)
    {
        lock (_gate) return TryGetLocked(key, out value);
    }

    private bool TryGetLocked(string key, out T? value)
    {
        value = null;
        if (!_items.TryGetValue(key, out var entry)) return false;
        if (entry.Expires is { } expires && expires <= _clock())
        {
            _items.Remove(key);
            _order.Remove(entry.Node);
            return false;
        }
        _order.Remove(entry.Node);
        _order.AddLast(entry.Node);
        value = entry.Value;
        return true;
    }

    public Task<T?> GetOrCreateAsync(string key, Func<Task<T?>> loader)
    {
        TaskCompletionSource<T?> completion;
        lock (_gate)
        {
            if (TryGetLocked(key, out var cached)) return Task.FromResult(cached);
            if (_pending.TryGetValue(key, out var pending)) return pending;
            completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending[key] = completion.Task;
        }
        _ = LoadAsync(key, loader, completion);
        return completion.Task;
    }

    private async Task LoadAsync(string key, Func<Task<T?>> loader, TaskCompletionSource<T?> completion)
    {
        T? value = null;
        await _slots.WaitAsync().ConfigureAwait(false);
        try { value = await loader().ConfigureAwait(false); }
        catch { /* Failed images are briefly cached, then become eligible for retry. */ }
        finally { _slots.Release(); }
        lock (_gate)
        {
            if (_items.Remove(key, out var old)) _order.Remove(old.Node);
            var node = _order.AddLast(key);
            _items[key] = new Entry(value, value is null ? _clock().AddSeconds(30) : null, node);
            while (_items.Count > _capacity && _order.First is { } first)
            {
                _items.Remove(first.Value);
                _order.RemoveFirst();
            }
            _pending.Remove(key);
        }
        completion.TrySetResult(value);
    }
}

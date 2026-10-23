namespace LightNote.Core.Tests;

public sealed class BoundedAsyncCacheTests
{
    [Fact]
    public async Task ConcurrentRequestsShareOneLoaderAndOneResult()
    {
        var cache = new BoundedAsyncCache<object>(2, 3);
        var release = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        Task<object?> Load() { Interlocked.Increment(ref calls); return release.Task; }
        var tasks = Enumerable.Range(0, 20).Select(_ => cache.GetOrCreateAsync("same", Load)).ToArray();
        Assert.Equal(1, calls);
        var result = new object(); release.SetResult(result);
        foreach (var value in await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(5))) Assert.Same(result, value);
        Assert.Same(result, await cache.GetOrCreateAsync("same", Load));
        Assert.Equal(1, calls);
    }

    [Fact]
    public async Task LoadersStayWithinConcurrencyLimit()
    {
        var cache = new BoundedAsyncCache<object>(20, 3);
        var gate = new object(); var active = 0; var peak = 0;
        var tasks = Enumerable.Range(0, 12).Select(i => cache.GetOrCreateAsync(i.ToString(), async () =>
        {
            lock (gate) { active++; peak = Math.Max(active, peak); }
            await Task.Delay(15);
            lock (gate) active--;
            return new object();
        }));
        await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.InRange(peak, 1, 3); Assert.Equal(0, active);
    }

    [Fact]
    public async Task RecentHitsSurviveLruEviction()
    {
        var cache = new BoundedAsyncCache<object>(2, 1); var calls = 0;
        Task<object?> Load() { calls++; return Task.FromResult<object?>(new object()); }
        var first = await cache.GetOrCreateAsync("a", Load);
        var second = await cache.GetOrCreateAsync("b", Load);
        Assert.True(cache.TryGetValue("a", out var hit)); Assert.Same(first, hit);
        await cache.GetOrCreateAsync("c", Load);
        Assert.Same(first, await cache.GetOrCreateAsync("a", Load));
        Assert.NotSame(second, await cache.GetOrCreateAsync("b", Load));
        Assert.Equal(4, calls);
    }

    [Fact]
    public async Task FailedImagesRetryAfterShortNegativeCache()
    {
        var now = DateTimeOffset.UtcNow; var calls = 0;
        var cache = new BoundedAsyncCache<object>(2, 1, () => now);
        Task<object?> Load() { calls++; return calls == 1 ? Task.FromException<object?>(new IOException("offline")) : Task.FromResult<object?>(new object()); }
        Assert.Null(await cache.GetOrCreateAsync("retry", Load));
        Assert.Null(await cache.GetOrCreateAsync("retry", Load)); Assert.Equal(1, calls);
        now += TimeSpan.FromSeconds(31);
        Assert.NotNull(await cache.GetOrCreateAsync("retry", Load)); Assert.Equal(2, calls);
    }
}

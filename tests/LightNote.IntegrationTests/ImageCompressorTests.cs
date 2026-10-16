using LightNote.Infrastructure.Storage;
using SkiaSharp;

namespace LightNote.IntegrationTests;

public sealed class ImageCompressorTests
{
    [Fact]
    public void PhoneScreenshotKeepsItsResolutionAndDecodedPixels()
    {
        var original = CreateNoisyImage(1080, 2400, SKEncodedImageFormat.Png, 100);

        var compressed = ImageCompressor.Compress(original);

        using var bitmap = SKBitmap.Decode(compressed);
        using var originalBitmap = SKBitmap.Decode(original);
        Assert.Equal(1080, bitmap.Width);
        Assert.Equal(2400, bitmap.Height);
        Assert.True(originalBitmap.GetPixelSpan().SequenceEqual(bitmap.GetPixelSpan()));
        Assert.True(compressed.Length <= original.Length);
    }

    [Fact]
    public void LargePhotoIsLimitedToLongEdge3200AndRecompressed()
    {
        var original = CreateNoisyImage(4000, 3000, SKEncodedImageFormat.Jpeg, 98);

        var compressed = ImageCompressor.Compress(original);

        using var bitmap = SKBitmap.Decode(compressed);
        Assert.Equal(3200, bitmap.Width);
        Assert.Equal(2400, bitmap.Height);
        Assert.True(compressed.Length < original.Length);
    }

    [Fact]
    public void WideScreenshotKeepsItsResolutionAndDecodedPixels()
    {
        var original = CreateNoisyImage(3600, 1800, SKEncodedImageFormat.Png, 100);
        using var bitmap = SKBitmap.Decode(ImageCompressor.Compress(original));
        using var expected = SKBitmap.Decode(original);
        Assert.Equal(3600, bitmap.Width);
        Assert.Equal(1800, bitmap.Height);
        Assert.True(expected.GetPixelSpan().SequenceEqual(bitmap.GetPixelSpan()));
    }

    [Fact]
    public void WebpScreenshotDoesNotAcquireAdditionalLoss()
    {
        var original = CreateNoisyImage(1200, 900, SKEncodedImageFormat.Webp, 98);
        Assert.True(original.Length > 200 * 1024);
        using var expected = SKBitmap.Decode(original);
        using var actual = SKBitmap.Decode(ImageCompressor.Compress(original));
        Assert.Equal(expected.Width, actual.Width);
        Assert.Equal(expected.Height, actual.Height);
        Assert.True(expected.GetPixelSpan().SequenceEqual(actual.GetPixelSpan()));
    }

    [Fact]
    public void SmallHighResolutionPhotoStillRespectsTheSizeLimit()
    {
        using var originalBitmap = new SKBitmap(4000, 3000);
        originalBitmap.Erase(SKColors.White);
        using var image = SKImage.FromBitmap(originalBitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Jpeg, 98);
        var original = encoded.ToArray();
        Assert.True(original.Length < 200 * 1024);
        using var bitmap = SKBitmap.Decode(ImageCompressor.Compress(original));
        Assert.Equal(3200, bitmap.Width);
        Assert.Equal(2400, bitmap.Height);
    }

    [Fact]
    public void SmallImageIsLeftUntouched()
    {
        var original = CreateNoisyImage(100, 100, SKEncodedImageFormat.Png, 100);

        Assert.Same(original, ImageCompressor.Compress(original));
    }

    [Fact]
    public void InvalidDataIsReturnedAsIs()
    {
        var original = new byte[300 * 1024];

        Assert.Same(original, ImageCompressor.Compress(original));
    }

    internal static byte[] CreateNoisyImage(int width, int height, SKEncodedImageFormat format, int quality)
    {
        using var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Opaque);
        var random = new Random(42);
        var pixels = new SKColor[width * height];
        for (var i = 0; i < pixels.Length; i++)
        {
            var x = i % width;
            var y = i / width;
            pixels[i] = new SKColor(
                (byte)((x / 8 + random.Next(0, 40)) % 256),
                (byte)((y / 8 + random.Next(0, 40)) % 256),
                (byte)(random.Next(0, 256)));
        }

        bitmap.Pixels = pixels;
        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(format, quality);
        return data.ToArray();
    }
}

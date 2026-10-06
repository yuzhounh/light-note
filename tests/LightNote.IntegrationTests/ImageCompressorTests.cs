using LightNote.Infrastructure.Storage;
using SkiaSharp;

namespace LightNote.IntegrationTests;

public sealed class ImageCompressorTests
{
    [Fact]
    public void PhoneScreenshotIsScaledToHalfWidth()
    {
        var original = CreateNoisyImage(1080, 2400, SKEncodedImageFormat.Png, 100);

        var compressed = ImageCompressor.Compress(original);

        using var bitmap = SKBitmap.Decode(compressed);
        Assert.Equal(540, bitmap.Width);
        Assert.Equal(1200, bitmap.Height);
        Assert.True(compressed.Length < original.Length);
    }

    [Fact]
    public void LargePhotoIsLimitedToLongEdge2560AndRecompressed()
    {
        var original = CreateNoisyImage(4000, 3000, SKEncodedImageFormat.Jpeg, 98);

        var compressed = ImageCompressor.Compress(original);

        using var bitmap = SKBitmap.Decode(compressed);
        Assert.Equal(2560, bitmap.Width);
        Assert.Equal(1920, bitmap.Height);
        Assert.True(compressed.Length < original.Length);
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

    private static byte[] CreateNoisyImage(int width, int height, SKEncodedImageFormat format, int quality)
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

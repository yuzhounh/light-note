using SkiaSharp;

namespace LightNote.Infrastructure.Storage;

/// <summary>
/// 插入笔记的图片入库前压缩：手机截屏缩到 50% 宽度，其他图片长边最多 2560 像素；
/// 照片重新编码为 JPEG，大的无透明 PNG 在更小时转为 WebP。无法处理或压缩后更大时保留原图。
/// </summary>
public static class ImageCompressor
{
    private const int SkipBelowBytes = 200 * 1024;
    private const int MaxLongEdge = 2560;
    private const int PhoneScreenshotMaxWidth = 1500;
    private const double PhoneScreenshotMinAspect = 1.9;
    private const int JpegQuality = 82;
    private const int WebpQuality = 85;
    private const int PngToWebpThresholdBytes = 500 * 1024;

    public static byte[] Compress(byte[] content)
    {
        try
        {
            return CompressCore(content) ?? content;
        }
        catch (Exception)
        {
            return content;
        }
    }

    private static byte[]? CompressCore(byte[] content)
    {
        if (content.Length < SkipBelowBytes)
        {
            return null;
        }

        using var data = SKData.CreateCopy(content);
        using var codec = SKCodec.Create(data);
        if (codec is null || codec.FrameCount > 1)
        {
            return null; // 无法识别，或为动图
        }

        var format = codec.EncodedFormat;
        if (format is not (SKEncodedImageFormat.Jpeg or SKEncodedImageFormat.Png or SKEncodedImageFormat.Webp))
        {
            return null;
        }

        using var decoded = SKBitmap.Decode(codec);
        if (decoded is null)
        {
            return null;
        }

        using var oriented = ApplyOrientation(decoded, codec.EncodedOrigin);
        var scale = ComputeScale(oriented.Width, oriented.Height);
        var hasAlpha = format != SKEncodedImageFormat.Jpeg && HasTransparency(oriented);

        using var resized = scale < 1 ? Resize(oriented, scale) : null;
        var source = resized ?? oriented;
        using var image = SKImage.FromBitmap(source);

        byte[]? best = null;
        switch (format)
        {
            case SKEncodedImageFormat.Jpeg:
                best = Encode(image, SKEncodedImageFormat.Jpeg, JpegQuality);
                break;
            case SKEncodedImageFormat.Webp:
                best = Encode(image, SKEncodedImageFormat.Webp, WebpQuality);
                break;
            case SKEncodedImageFormat.Png:
                best = Encode(image, SKEncodedImageFormat.Png, 100);
                if (!hasAlpha && best.Length > PngToWebpThresholdBytes)
                {
                    var webp = Encode(image, SKEncodedImageFormat.Webp, WebpQuality);
                    if (webp.Length < best.Length)
                    {
                        best = webp;
                    }
                }

                break;
        }

        return best is not null && best.Length < content.Length ? best : null;
    }

    private static double ComputeScale(int width, int height)
    {
        if (width <= 0 || height <= 0)
        {
            return 1;
        }

        var isPhoneScreenshot = height >= width * PhoneScreenshotMinAspect && width <= PhoneScreenshotMaxWidth;
        if (isPhoneScreenshot)
        {
            return 0.5;
        }

        var longEdge = Math.Max(width, height);
        return longEdge > MaxLongEdge ? (double)MaxLongEdge / longEdge : 1;
    }

    private static byte[] Encode(SKImage image, SKEncodedImageFormat format, int quality)
    {
        using var encoded = image.Encode(format, quality);
        return encoded.ToArray();
    }

    private static bool HasTransparency(SKBitmap bitmap)
    {
        if (bitmap.AlphaType == SKAlphaType.Opaque)
        {
            return false;
        }

        var pixels = bitmap.Pixels;
        foreach (var pixel in pixels)
        {
            if (pixel.Alpha < 255)
            {
                return true;
            }
        }

        return false;
    }

    private static SKBitmap Resize(SKBitmap source, double scale)
    {
        var width = Math.Max(1, (int)Math.Round(source.Width * scale));
        var height = Math.Max(1, (int)Math.Round(source.Height * scale));
        var info = new SKImageInfo(width, height, SKColorType.Rgba8888, source.AlphaType == SKAlphaType.Opaque
            ? SKAlphaType.Opaque
            : SKAlphaType.Premul);
        var target = new SKBitmap(info);
        using var image = SKImage.FromBitmap(source);
        using var pixmap = target.PeekPixels();
        image.ScalePixels(pixmap, new SKSamplingOptions(SKCubicResampler.Mitchell));
        return target;
    }

    /// <summary>按 EXIF 方向把图片转正，避免手机竖拍照片缩放后被旋转 90°。</summary>
    private static SKBitmap ApplyOrientation(SKBitmap source, SKEncodedOrigin origin)
    {
        if (origin is SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default)
        {
            return source.Copy();
        }

        var swap = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var width = swap ? source.Height : source.Width;
        var height = swap ? source.Width : source.Height;
        var result = new SKBitmap(new SKImageInfo(width, height, source.ColorType, source.AlphaType));
        using var canvas = new SKCanvas(result);
        canvas.Clear(SKColors.Transparent);
        var w = source.Width;
        var h = source.Height;
        var matrix = origin switch
        {
            SKEncodedOrigin.TopRight => new SKMatrix(-1, 0, w, 0, 1, 0, 0, 0, 1),
            SKEncodedOrigin.BottomRight => new SKMatrix(-1, 0, w, 0, -1, h, 0, 0, 1),
            SKEncodedOrigin.BottomLeft => new SKMatrix(1, 0, 0, 0, -1, h, 0, 0, 1),
            SKEncodedOrigin.LeftTop => new SKMatrix(0, 1, 0, 1, 0, 0, 0, 0, 1),
            SKEncodedOrigin.RightTop => new SKMatrix(0, -1, h, 1, 0, 0, 0, 0, 1),
            SKEncodedOrigin.RightBottom => new SKMatrix(0, -1, h, -1, 0, w, 0, 0, 1),
            SKEncodedOrigin.LeftBottom => new SKMatrix(0, 1, 0, -1, 0, w, 0, 0, 1),
            _ => SKMatrix.Identity,
        };
        canvas.SetMatrix(matrix);
        canvas.DrawBitmap(source, 0, 0);
        return result;
    }
}

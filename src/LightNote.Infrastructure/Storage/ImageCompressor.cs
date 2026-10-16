using SkiaSharp;

namespace LightNote.Infrastructure.Storage;

/// <summary>
/// PNG/WebP 保留像素尺寸并使用无损编码；JPEG 照片长边最多 3200，编码质量 90。
/// 小文件和无法处理的图片保留原文件；动图不重新编码。
/// </summary>
public static class ImageCompressor
{
    private const int SkipBelowBytes = 200 * 1024;
    private const int MaxPhotoLongEdge = 3200;
    private const int JpegQuality = 90;

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
        var jpegHeader = content.Length >= 2 && content[0] == 0xff && content[1] == 0xd8;
        if (content.Length < SkipBelowBytes && !jpegHeader)
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
        if (content.Length < SkipBelowBytes && Math.Max(codec.Info.Width, codec.Info.Height) <= MaxPhotoLongEdge)
            return null;

        using var decoded = SKBitmap.Decode(codec);
        if (decoded is null)
        {
            return null;
        }

        using var oriented = codec.EncodedOrigin is SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default
            ? null : ApplyOrientation(decoded, codec.EncodedOrigin);
        var upright = oriented ?? decoded;
        var longEdge = Math.Max(upright.Width, upright.Height);
        var scale = format == SKEncodedImageFormat.Jpeg && longEdge > MaxPhotoLongEdge
            ? (double)MaxPhotoLongEdge / longEdge : 1;
        using var resized = scale < 1 ? Resize(upright, scale) : null;
        var source = resized ?? upright;
        using var image = SKImage.FromBitmap(source);

        byte[]? best = null;
        switch (format)
        {
            case SKEncodedImageFormat.Jpeg:
                best = Encode(image, SKEncodedImageFormat.Jpeg, JpegQuality);
                break;
            case SKEncodedImageFormat.Webp:
                using (var pixmap = source.PeekPixels())
                using (var encoded = pixmap.Encode(new SKWebpEncoderOptions(SKWebpEncoderCompression.Lossless, 50)))
                    best = encoded?.ToArray();
                break;
            case SKEncodedImageFormat.Png:
                best = Encode(image, SKEncodedImageFormat.Png, 100);
                break;
        }

        return best is not null && (scale < 1 || best.Length < content.Length) ? best : null;
    }

    private static byte[] Encode(SKImage image, SKEncodedImageFormat format, int quality)
    {
        using var encoded = image.Encode(format, quality);
        return encoded.ToArray();
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

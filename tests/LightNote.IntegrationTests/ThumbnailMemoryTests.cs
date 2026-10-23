using LightNote.App;
using LightNote.Core.Models;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace LightNote.IntegrationTests;

public sealed class ThumbnailMemoryTests
{
    [Fact]
    public void VirtualAttachmentPathsStayInsideTheirAttachmentDirectory()
    {
        var workspace = new DirectoryInfo(AppContext.BaseDirectory);
        while (workspace is not null && !File.Exists(Path.Combine(workspace.FullName, "LightNote.slnx"))) workspace = workspace.Parent;
        Assert.NotNull(workspace);
        var allowed = Path.GetFullPath(Path.Combine(workspace.FullName, "tmp", "thumbnail-tests"));
        var folder = Path.Combine(allowed, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(folder, "attachments"));
        try
        {
            var outside = Path.Combine(folder, "outside.png");
            var image = BitmapSource.Create(1, 1, 96, 96, PixelFormats.Pbgra32, null, new byte[] { 0, 255, 0, 255 }, 4);
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(image));
            using (var file = File.Create(outside)) encoder.Save(file);
            var note = new Note { Id = "outside", Title = "Outside", BodyJson = "{}", BodyHtml = "<img src=\"https://lightnote.attachments/%2e%2e%2foutside.png\">", BodyText = "", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
            var item = new NoteListItem(note, attachmentsDirectory: Path.Combine(folder, "attachments"), thumbnailCacheDirectory: Path.Combine(folder, "cache"));
            Assert.Null(item.ThumbnailSource); Assert.True(File.Exists(outside));
        }
        finally
        {
            var target = Path.GetFullPath(folder);
            if (target.StartsWith(allowed + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) Directory.Delete(target, true);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void LargeImagesKeepCenterSquareDpiAndIndependentSmallPixels(bool portrait)
    {
        var workspace = new DirectoryInfo(AppContext.BaseDirectory);
        while (workspace is not null && !File.Exists(Path.Combine(workspace.FullName, "LightNote.slnx"))) workspace = workspace.Parent;
        Assert.NotNull(workspace);
        var allowed = Path.GetFullPath(Path.Combine(workspace.FullName, "tmp", "thumbnail-tests"));
        var folder = Path.Combine(allowed, Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try
        {
            var width = portrait ? 400 : 1200; var height = portrait ? 1200 : 400;
            var pixels = new byte[width * height * 4];
            for (var y = 0; y < height; y++) for (var x = 0; x < width; x++)
            {
                var position = portrait ? y : x; var offset = (y * width + x) * 4;
                pixels[offset + (position < 400 ? 2 : position < 800 ? 1 : 0)] = 255;
                pixels[offset + 3] = 255;
            }
            var source = BitmapSource.Create(width, height, 144, 144, PixelFormats.Pbgra32, null, pixels, width * 4);
            var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source));
            var file = Path.Combine(folder, "source.png"); using (var output = File.Create(file)) encoder.Save(output);
            var originalHash = SHA256.HashData(File.ReadAllBytes(file));
            var note = new Note { Id = "thumbnail", Title = "Image", BodyJson = "{}", BodyHtml = "<img src=\"https://lightnote.attachments/source.png\">", BodyText = "", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
            var item = new NoteListItem(note, attachmentsDirectory: folder, thumbnailCacheDirectory: Path.Combine(folder, "cache"));
            var image = Assert.IsAssignableFrom<BitmapSource>(item.ThumbnailSource);
            Assert.Equal(192, image.PixelWidth); Assert.Equal(192, image.PixelHeight); Assert.True(image.IsFrozen);
            Assert.InRange(image.DpiX, 143, 145); Assert.InRange(image.DpiY, 143, 145);
            Assert.IsNotType<TransformedBitmap>(image); Assert.IsNotType<CroppedBitmap>(image);
            var center = new byte[4]; image.CopyPixels(new Int32Rect(96, 96, 1, 1), center, 4, 0);
            Assert.True(center[1] > 240 && center[0] < 15 && center[2] < 15);
            Assert.Equal(originalHash, SHA256.HashData(File.ReadAllBytes(file)));
            Assert.Single(Directory.GetFiles(Path.Combine(folder, "cache"), "*.png"));
        }
        finally
        {
            var target = Path.GetFullPath(folder);
            if (target.StartsWith(allowed + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) Directory.Delete(target, true);
        }
    }
}

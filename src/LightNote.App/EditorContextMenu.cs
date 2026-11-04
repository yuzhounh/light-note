using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using LightNote.Core.Abstractions;
using LightNote.Infrastructure.Storage;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Clipboard = System.Windows.Clipboard;

namespace LightNote.App;

/// <summary>One native menu implementation shared by the main and detached editors.</summary>
internal sealed class EditorContextMenu(
    WebView2 web, Window owner, AppDataPaths paths, IAppLogger logger, Action<string> openExternal)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private MenuContext? _context;
    private bool _contextReceived;
    private TaskCompletionSource<MenuContext?>? _contextReady;

    public static void Attach(WebView2 web, Window owner, AppDataPaths paths, IAppLogger logger, Action<string> openExternal)
    {
        var controller = new EditorContextMenu(web, owner, paths, logger, openExternal);
        web.CoreWebView2.WebMessageReceived += controller.OnContextReceived;
        web.CoreWebView2.ContextMenuRequested += controller.OnRequested;
    }

    private void OnContextReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!args.Source.StartsWith("https://lightnote.editor/", StringComparison.OrdinalIgnoreCase)) return;
        using var message = JsonDocument.Parse(args.WebMessageAsJson);
        if (!message.RootElement.TryGetProperty("type", out var type) || type.GetString() != "editor.contextMenu") return;
        _context = message.RootElement.GetProperty("payload").Deserialize<MenuContext>(JsonOptions);
        _contextReceived = true;
        _contextReady?.TrySetResult(_context);
    }

    private async void OnRequested(object? sender, CoreWebView2ContextMenuRequestedEventArgs args)
    {
        args.Handled = true;
        var deferral = args.GetDeferral();
        var completed = false;
        void Complete()
        {
            if (completed) return;
            completed = true;
            deferral.Complete();
        }

        try
        {
            // The renderer waits for this event's deferral: never call ExecuteScriptAsync here.
            if (!_contextReceived)
            {
                _contextReady = new(TaskCreationOptions.RunContinuationsAsynchronously);
                await _contextReady.Task.WaitAsync(TimeSpan.FromSeconds(1));
                _contextReady = null;
            }
            var context = _context;
            _context = null;
            _contextReceived = false;
            // Formula-dialog text fields also get an application menu, using their native edit commands.
            context ??= new MenuContext
            {
                X = args.Location.X, Y = args.Location.Y,
                Items = [
                    new() { Id = "native.undo", Label = "撤销", Enabled = true, Shortcut = "Ctrl+Z" },
                    new() { Id = "native.redo", Label = "重做", Enabled = true, Shortcut = "Ctrl+Y" },
                    new() { Separator = true },
                    new() { Id = "cut", Label = "剪切", Enabled = true, Shortcut = "Ctrl+X" },
                    new() { Id = "copy", Label = "复制", Enabled = true, Shortcut = "Ctrl+C" },
                    new() { Id = "paste", Label = "粘贴", Enabled = true, Shortcut = "Ctrl+V" },
                    new() { Separator = true },
                    new() { Id = "native.selectAll", Label = "全选", Enabled = true, Shortcut = "Ctrl+A" },
                ],
            };
            var nativeItems = Flatten(args.MenuItems)
                .Where(entry => entry.Kind == CoreWebView2ContextMenuItemKind.Command)
                .GroupBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);
            MenuEntry? chosen = null;
            CoreWebView2ContextMenuItem? nativeChosen = null;
            var menu = new ContextMenu { PlacementTarget = web, Placement = PlacementMode.RelativePoint };
            var scale = context.ViewportWidth > 0 ? web.ActualWidth / context.ViewportWidth : 1;
            menu.HorizontalOffset = context.X * scale;
            menu.VerticalOffset = context.Y * scale;

            void Populate(ItemsControl parent, IEnumerable<MenuEntry> entries)
            {
                foreach (var entry in entries)
                {
                    if (entry.Separator) { parent.Items.Add(new Separator()); continue; }
                    var item = new MenuItem
                    {
                        Header = entry.Label, InputGestureText = entry.Shortcut,
                        IsEnabled = entry.Enabled, IsCheckable = entry.Checked, IsChecked = entry.Checked,
                    };
                    if (entry.Children.Count > 0) Populate(item, entry.Children);
                    else
                    {
                        var nativeName = entry.Id switch
                        {
                            "cut" => "cut", "copy" => "copy", "paste" => "paste", "image.copy" => "copyImage",
                            "native.undo" => "undo", "native.redo" => "redo", "native.selectAll" => "selectAll", _ => null,
                        };
                        CoreWebView2ContextMenuItem? native = null;
                        if (nativeName is not null)
                        {
                            nativeItems.TryGetValue(nativeName, out native);
                            if (entry.Id == "image.copy" && native?.IsEnabled != true)
                            {
                                native = null;
                                item.IsEnabled &= ResolveImagePath(context.ImageSrc) is not null;
                            }
                            else item.IsEnabled &= native?.IsEnabled == true;
                        }
                        if (entry.Id == "paste.plain") item.IsEnabled &= Clipboard.ContainsText();
                        if (entry.Id == "image.save") item.IsEnabled &= ResolveImagePath(context.ImageSrc) is not null;
                        item.Click += (_, e) =>
                        {
                            e.Handled = true;
                            chosen = entry;
                            nativeChosen = native;
                        };
                    }
                    parent.Items.Add(item);
                }
            }

            Populate(menu, context.Items);
            ((FrameworkElement)web).ContextMenu = menu;
            menu.Opened += (_, _) =>
            {
                menu.Focus();
                menu.MoveFocus(new TraversalRequest(FocusNavigationDirection.First));
            };
            menu.Closed += async (_, _) =>
            {
                ((FrameworkElement)web).ContextMenu = null;
                try
                {
                    if (owner.IsActive) web.Focus();
                    if (chosen is not null)
                    {
                        // Native clipboard commands execute when the WebView2 deferral completes.
                        if (nativeChosen is not null) args.SelectedCommandId = nativeChosen.CommandId;
                        Complete();
                        if (nativeChosen is null && await IsCurrentAsync(context.Id)) await ExecuteAsync(context, chosen.Id);
                    }
                }
                catch (Exception exception) { ReportFailure(exception); }
                finally { Complete(); }
            };
            menu.IsOpen = true;
        }
        catch (Exception exception)
        {
            _contextReady = null;
            Complete();
            ReportFailure(exception);
        }
    }

    private async Task<bool> IsCurrentAsync(int id) =>
        await web.CoreWebView2.ExecuteScriptAsync($"window.lightNoteEditor?.contextMenu.read()?.id === {id}") == "true";

    private Task<string> RunAsync(MenuContext context, string command, string? value = null) =>
        web.CoreWebView2.ExecuteScriptAsync(
            $"window.lightNoteEditor?.contextMenu.run({context.Id}, {JsonSerializer.Serialize(command)}, {JsonSerializer.Serialize(value)})");

    private async Task ExecuteAsync(MenuContext context, string command)
    {
        switch (command)
        {
            case "link.open":
                if (context.Link is not null) openExternal(context.Link);
                break;
            case "link.copy":
                if (!string.IsNullOrEmpty(context.Link)) Clipboard.SetText(context.Link);
                break;
            case "math.copy":
                if (!string.IsNullOrEmpty(context.Latex)) Clipboard.SetText(context.Latex);
                break;
            case "link.edit":
                var prompt = new TextPromptDialog("编辑链接", "链接地址（http、https 或 mailto）：", context.Link ?? "") { Owner = owner };
                if (prompt.ShowDialog() != true) return;
                if (!Uri.TryCreate(prompt.Value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https" or "mailto"))
                {
                    MessageDialog.Show(owner, "请输入有效的网页或邮件链接地址。", "编辑链接", MessageBoxButton.OK, MessageBoxImage.Information);
                    return;
                }
                await RunAsync(context, command, prompt.Value);
                break;
            case "paste.plain":
                if (Clipboard.ContainsText()) await RunAsync(context, command, Clipboard.GetText());
                break;
            case "image.copy":
                var copyPath = ResolveImagePath(context.ImageSrc);
                if (copyPath is null) return;
                using (var bitmap = SkiaSharp.SKBitmap.Decode(copyPath) ?? throw new InvalidDataException("图片无法解码。"))
                using (var image = SkiaSharp.SKImage.FromBitmap(bitmap))
                using (var encoded = image.Encode(SkiaSharp.SKEncodedImageFormat.Png, 100))
                using (var stream = new MemoryStream(encoded.ToArray()))
                {
                    var source = new BitmapImage();
                    source.BeginInit();
                    source.CacheOption = BitmapCacheOption.OnLoad;
                    source.StreamSource = stream;
                    source.EndInit();
                    source.Freeze();
                    Clipboard.SetImage(source);
                }
                break;
            case "image.save":
                var imagePath = ResolveImagePath(context.ImageSrc);
                if (imagePath is null) return;
                var dialog = new Microsoft.Win32.SaveFileDialog
                {
                    Title = "图片另存为", FileName = Path.GetFileName(imagePath),
                    Filter = "图片文件|*" + Path.GetExtension(imagePath), AddExtension = true,
                    DefaultExt = Path.GetExtension(imagePath), OverwritePrompt = true,
                };
                if (dialog.ShowDialog(owner) == true && !string.Equals(imagePath, dialog.FileName, StringComparison.OrdinalIgnoreCase))
                    File.Copy(imagePath, dialog.FileName, overwrite: true);
                break;
            default:
                await RunAsync(context, command);
                break;
        }
    }

    private string? ResolveImagePath(string? source)
    {
        if (!Uri.TryCreate(source, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || uri.Host != "lightnote.attachments") return null;
        var root = Path.GetFullPath(paths.AttachmentsDirectory) + Path.DirectorySeparatorChar;
        var relative = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var file = Path.GetFullPath(Path.Combine(root, relative));
        return file.StartsWith(root, StringComparison.OrdinalIgnoreCase) && File.Exists(file) ? file : null;
    }

    private void ReportFailure(Exception exception)
    {
        logger.Error("Editor context menu action failed.", exception);
        MessageDialog.Show(owner, "操作未完成，请稍后重试。", "LightNote", MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private static IEnumerable<CoreWebView2ContextMenuItem> Flatten(IList<CoreWebView2ContextMenuItem> items)
    {
        foreach (var item in items)
        {
            yield return item;
            if (item.Kind == CoreWebView2ContextMenuItemKind.Submenu)
                foreach (var child in Flatten(item.Children)) yield return child;
        }
    }

    private sealed class MenuContext
    {
        public int Id { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
        public double ViewportWidth { get; set; }
        public List<MenuEntry> Items { get; set; } = [];
        public string? Link { get; set; }
        public string? ImageSrc { get; set; }
        public string? Latex { get; set; }
    }

    private sealed class MenuEntry
    {
        public string Id { get; set; } = "";
        public string Label { get; set; } = "";
        public string Shortcut { get; set; } = "";
        public bool Enabled { get; set; }
        public bool Checked { get; set; }
        public bool Separator { get; set; }
        public List<MenuEntry> Children { get; set; } = [];
    }
}

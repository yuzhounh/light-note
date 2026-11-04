using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Infrastructure.Storage;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Clipboard = System.Windows.Clipboard;

namespace LightNote.IntegrationTests;

public sealed class EditorContextMenuTests
{
    public async Task VerifyAsync()
    {
        var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.InitializeComponent();
        var paths = new AppDataPaths(Path.Combine(Directory.GetCurrentDirectory(), "tmp", "editor-context-menu", Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(paths.AttachmentsDirectory);
        var encoder = new System.Windows.Media.Imaging.PngBitmapEncoder();
        encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(System.Windows.Media.Imaging.BitmapSource.Create(
            4, 4, 96, 96, System.Windows.Media.PixelFormats.Bgra32, null, Enumerable.Repeat((byte)255, 64).ToArray(), 16)));
        using (var imageFile = File.Create(Path.Combine(paths.AttachmentsDirectory, "test.png"))) encoder.Save(imageFile);
        var clipboard = new DataObject();
        if (Clipboard.GetDataObject() is { } oldClipboard)
            foreach (var format in oldClipboard.GetFormats(autoConvert: false))
                if (oldClipboard.GetData(format, autoConvert: false) is { } data) clipboard.SetData(format, data);
        var web = new WebView2();
        var owner = new Window { Title = "LightNote 编辑菜单验证", Width = 900, Height = 650, Content = web, ShowActivated = false };
        ContextMenu? opened = null;
        var external = new List<string>();
        var logger = new ProbeLogger();
        var requests = 0;
        owner.Show();
        try
        {
            await web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(userDataFolder: paths.WebViewDataDirectory));
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("lightnote.editor", Path.Combine(AppContext.BaseDirectory, "Editor"), CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("lightnote.attachments", paths.AttachmentsDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
            typeof(MainWindow).Assembly.GetType("LightNote.App.EditorContextMenu", throwOnError: true)!
                .GetMethod("Attach", BindingFlags.Public | BindingFlags.Static)!
                .Invoke(null, [web, owner, paths, logger, (Action<string>)(uri => external.Add(uri))]);
            web.CoreWebView2.NewWindowRequested += (_, args) => { args.Handled = true; external.Add(args.Uri); };
            web.CoreWebView2.ContextMenuRequested += (_, _) => requests++;
            web.Source = new Uri("https://lightnote.editor/index.html");
            await WaitAsync(async () => await Script("Boolean(window.lightNoteEditor)") == "true", "editor bridge");
            web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "note.load", payload = new
            {
                id = "native-menu-test", title = "menu", html = "<p>alpha beta</p><p><a href=\"https://example.com\">Example</a></p>" +
                    "<img src=\"https://lightnote.attachments/test.png\" width=\"200px\" data-image-width-mode=\"manual\" data-image-base-width=\"200\">",
                readOnly = false,
            } }));
            await WaitAsync(async () => await Script("Boolean(document.querySelector('.tiptap')?.editor?.isEditable)") == "true", "editable note");
            await Script("window.menuEditor = document.querySelector('.tiptap').editor; menuEditor.commands.setTextSelection({from:1,to:6})");
            var menu = await OpenAsync(".tiptap p");
            Assert.True(Find(menu, "复制").IsEnabled);
            Assert.DoesNotContain(menu.Items.OfType<MenuItem>(), item => item.Header?.ToString()?.Contains("刷新") == true);
            Assert.Equal("5", await Script("menuEditor.state.selection.to-menuEditor.state.selection.from"));
            Choose(menu, "复制");
            await WaitAsync(() => Task.FromResult(Clipboard.ContainsText() && Clipboard.GetText() == "alpha"), "native copy");

            Clipboard.SetText("Z");
            await Script("menuEditor.commands.setTextSelection(6)");
            menu = await OpenAsync(".tiptap p", rightEdge: true);
            Assert.True(Find(menu, "粘贴").IsEnabled);
            Choose(menu, "粘贴");
            await WaitAsync(async () => (await Script("menuEditor.getText()")).Contains("Z"), "native paste");

            Clipboard.SetText("**literal**");
            menu = await OpenAsync(".tiptap p", rightEdge: true);
            Choose(menu, "粘贴为纯文本");
            await WaitAsync(async () => (await Script("menuEditor.getText()")).Contains("**literal**"), "plain paste");
            Assert.Equal("false", await Script("Boolean(document.querySelector('.tiptap strong'))"));

            menu = await OpenAsync(".tiptap a");
            Assert.True(Find(menu, "编辑链接…").IsEnabled);
            Choose(menu, "用默认浏览器打开");
            await WaitAsync(() => Task.FromResult(external.Count == 1), "external link callback");
            Assert.Equal("https://example.com", external[0]);

            menu = await OpenAsync(".tiptap img");
            Assert.True(Find(menu, "复制图片").IsEnabled);
            Assert.True(Find(menu, "图片另存为…").IsEnabled);
            Choose(menu, "复制图片");
            await WaitAsync(() => Task.FromResult(Clipboard.ContainsImage()), "native image copy");
            await Script("window.__openMathModal({isExisting:false,isBlock:false,latex:'x^2',pos:1,to:1})");
            await WaitAsync(async () => await Script("Boolean(document.querySelector('.math-modal-input'))") == "true", "formula dialog");
            Clipboard.SetText("y^2");
            menu = await OpenAsync(".math-modal-input");
            Assert.True(Find(menu, "粘贴").IsEnabled);
            Choose(menu, "粘贴");
            await WaitAsync(async () => (await Script("document.querySelector('.math-modal-input').value")).Contains("y^2"), "formula-field native paste");
            await Script("[...document.querySelectorAll('.math-modal-footer button')].find(b=>b.textContent==='取消').click();menuEditor.commands.setTextSelection(1);menuEditor.commands.focus()");
            opened = null;
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(
                new { type = "rawKeyDown", key = "F10", code = "F10", windowsVirtualKeyCode = 121, modifiers = 8 }));
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchKeyEvent", JsonSerializer.Serialize(
                new { type = "keyUp", key = "F10", code = "F10", windowsVirtualKeyCode = 121, modifiers = 8 }));
            await WaitAsync(() => { opened = ((FrameworkElement)web).ContextMenu; return Task.FromResult(opened?.IsOpen == true && opened.IsVisible); }, "keyboard context menu");
            Assert.Equal("全选", Find(opened!, "全选").Header);
            opened!.IsOpen = false;
            Assert.Empty(logger.Errors);
            Console.WriteLine("Native editor menus: selection, copy, paste, plain text, external link, image copy/save availability, formula input and keyboard menu passed.");
        }
        finally
        {
            if (opened?.IsOpen == true) opened.IsOpen = false;
            web.Dispose();
            owner.Close();
            Clipboard.SetDataObject(clipboard, copy: true);
            app.Shutdown();
        }

        Task<string> Script(string code) => web.CoreWebView2.ExecuteScriptAsync(code);

        async Task<ContextMenu> OpenAsync(string selector, bool rightEdge = false)
        {
            opened = null;
            owner.Activate();
            web.Focus();
            var json = await Script($$"""
                (()=>{const r=document.querySelector({{JsonSerializer.Serialize(selector)}}).getBoundingClientRect();
                  return {x:{{(rightEdge ? "r.right-10" : "r.left+10")}}, y:r.top+Math.min(10,r.height/2)};})()
                """);
            using var point = JsonDocument.Parse(json);
            var x = point.RootElement.GetProperty("x").GetDouble();
            var y = point.RootElement.GetProperty("y").GetDouble();
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(
                new { type = "mousePressed", x, y, button = "right", buttons = 2, clickCount = 1 }));
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", JsonSerializer.Serialize(
                new { type = "mouseReleased", x, y, button = "right", buttons = 0, clickCount = 1 }));
            try { await WaitAsync(() => { opened = ((FrameworkElement)web).ContextMenu; return Task.FromResult(opened?.IsOpen == true && opened.IsVisible); }, "native WPF context menu"); }
            catch
            {
                Console.Error.WriteLine($"Context requests={requests}, menu loaded={opened is not null}, open={opened?.IsOpen}, active={owner.IsActive}");
                Console.Error.WriteLine(await Script("JSON.stringify(window.lightNoteEditor.contextMenu.read())"));
                throw;
            }
            Assert.True(opened!.IsVisible);
            return opened!;
        }
    }

    private static MenuItem Find(ContextMenu menu, string label) => menu.Items.OfType<MenuItem>().Single(item => item.Header?.ToString() == label);

    private static void Choose(ContextMenu menu, string label)
    {
        var item = Find(menu, label);
        item.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent, item));
        menu.IsOpen = false;
    }

    private static async Task WaitAsync(Func<Task<bool>> ready, string operation)
    {
        for (var attempt = 0; attempt < 150; attempt++)
        {
            if (await ready()) return;
            await Task.Delay(20);
        }
        throw new InvalidOperationException("Timed out waiting for " + operation);
    }

    private sealed class ProbeLogger : IAppLogger
    {
        public List<string> Errors { get; } = [];
        public void Info(string message) { }
        public void Error(string message, Exception exception) { Errors.Add(message); Console.Error.WriteLine(exception); }
    }
}

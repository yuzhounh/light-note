using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;
using LightNote.Infrastructure.Sync;
using Microsoft.Web.WebView2.Wpf;
using SkiaSharp;

namespace LightNote.IntegrationTests;

public sealed class ImagePasteResponsivenessTests
{
    public void PasteScreenshotsWhileContinuingToType()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            var dispatcher = Dispatcher.CurrentDispatcher;
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(dispatcher));
            dispatcher.BeginInvoke(new Action(async () =>
            {
                try { await RunAsync(); }
                catch (Exception exception) { failure = exception; }
                finally { dispatcher.BeginInvokeShutdown(DispatcherPriority.Background); }
            }));
            Dispatcher.Run();
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(30)), "Image paste blocked the native UI test.");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private static async Task RunAsync()
    {
        // Generated phone and wide screenshots below make this suite portable to CI.
        // Optional real screenshots can still be supplied for local verification.
        var imagePaths = Environment.GetEnvironmentVariable("LIGHTNOTE_PASTE_TEST_IMAGES")
            ?.Split('|', StringSplitOptions.RemoveEmptyEntries) ?? [];
        var directory = Path.Combine(Directory.GetCurrentDirectory(), "tmp", "image-paste-ui", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var phonePath = Path.Combine(directory, "phone-source.png");
        using (var bitmap = new SKBitmap(1080, 2400))
        {
            bitmap.Erase(SKColors.LightBlue);
            using var image = SKImage.FromBitmap(bitmap);
            using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
            await File.WriteAllBytesAsync(phonePath, encoded.ToArray());
        }
        imagePaths = imagePaths.Append(phonePath).ToArray();
        var widePath = Path.Combine(directory, "wide-source.png");
        using (var bitmap = new SKBitmap(2160, 1080))
        {
            bitmap.Erase(SKColors.White);
            using var image = SKImage.FromBitmap(bitmap);
            using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
            await File.WriteAllBytesAsync(widePath, encoded.ToArray());
        }
        imagePaths = imagePaths.Append(widePath).ToArray();
        var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.InitializeComponent();
        var paths = new AppDataPaths(directory);
        var factory = new SqliteConnectionFactory(paths);
        var logger = new ProbeLogger();
        await new SqliteDatabaseInitializer(factory, logger).InitializeAsync();
        var notes = new SqliteNoteRepository(factory);
        var settings = new AppSettingsService(paths);
        settings.Save(new AppSettings { RecordPasteSource = true, CompressImages = true });
        var attachments = new AttachmentService(paths, factory, settings);
        var now = DateTimeOffset.UtcNow;
        var note = new Note { Id = "paste-probe", Title = "Image paste probe", BodyHtml = "<p>Before paste</p>",
            BodyText = "Before paste", BodyJson = "{\"type\":\"doc\",\"content\":[]}", CreatedAt = now, UpdatedAt = now };
        await notes.UpsertAsync(note);
        using var http = new HttpClient();
        var vm = new MainViewModel(notes, new SqliteNotebookRepository(factory), logger, attachmentService: attachments);
        var window = new MainWindow(vm, paths, logger, attachments, null!, factory, null!, null!, null!,
            new FirebaseSyncService(paths, factory, http, logger), settings, new ThemeService());
        var root = (FrameworkElement)window.Content;
        window.Content = null;
        root.DataContext = vm;
        using var host = new HwndSource(new HwndSourceParameters("LightNote image paste test")
            { Width = 1180, Height = 760, WindowStyle = unchecked((int)0x80000000) });
        host.RootVisual = root;
        root.Measure(new Size(1180, 760));
        root.Arrange(new Rect(0, 0, 1180, 760));
        root.UpdateLayout();
        var web = (WebView2)window.FindName("EditorWebView");
        try
        {
            await vm.InitializeAsync();
            vm.SelectedNote = vm.Notes.Single(item => item.Model.Id == note.Id);
            var initialize = typeof(MainWindow).GetMethod("InitializeEditorAsync", BindingFlags.Instance | BindingFlags.NonPublic)!;
            await (Task)initialize.Invoke(window, null)!;
            await WaitForScriptAsync(web, "Boolean(document.querySelector('.tiptap')?.editor?.isEditable)", "true");
            var clock = Stopwatch.StartNew();
            var lastTick = clock.Elapsed.TotalMilliseconds;
            var ticks = 0;
            var maxGap = 0d;
            var heartbeat = new DispatcherTimer(DispatcherPriority.Normal) { Interval = TimeSpan.FromMilliseconds(10) };
            heartbeat.Tick += (_, _) => { var current = clock.Elapsed.TotalMilliseconds; maxGap = Math.Max(maxGap, current - lastTick); lastTick = current; ticks++; };
            heartbeat.Start();
            foreach (var imagePath in imagePaths)
            {
                var encoded = Convert.ToBase64String(await File.ReadAllBytesAsync(imagePath));
                await web.CoreWebView2.ExecuteScriptAsync($$"""
                    (() => {
                      const data = Uint8Array.from(atob({{JsonSerializer.Serialize(encoded)}}), c => c.charCodeAt(0));
                      const clipboard = new DataTransfer();
                      clipboard.items.add(new File([data], 'capture.png', { type: 'image/png' }));
                      document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
                      document.querySelector('.tiptap').editor.commands.insertContent(' typing while images save ');
                    })()
                    """);
            }
            await WaitForScriptAsync(web, "document.querySelectorAll('.tiptap img').length", imagePaths.Length.ToString());
            var layoutChecks = await web.CoreWebView2.ExecuteScriptAsync("""
                (() => {
                  const dom = document.querySelector('.tiptap'), editor = dom.editor;
                  dom.style.padding = '0'; dom.style.boxSizing = 'border-box'; dom.style.width = '1600px';
                  const images = [];
                  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') images.push({ node, pos }); });
                  const normal = images.find(item => item.node.attrs.baseWidth === 1080);
                  const phone = images.find(item => item.node.attrs.pixelWidth === 1080 && item.node.attrs.pixelHeight === 2400);
                  if (!normal || phone?.node.attrs.baseWidth !== 360) throw new Error('Incorrect default image width or lost phone pixels');
                  editor.commands.setNodeSelection(normal.pos);
                  return { normalWidth: normal.node.attrs.baseWidth, phoneWidth: phone.node.attrs.baseWidth };
                })()
                """);
            await WaitForScriptAsync(web, "Boolean(document.querySelector('[title=\"75% 默认宽度\"]'))", "true");
            foreach (var preset in new[] { 25, 50, 75, 100 })
            {
                await web.CoreWebView2.ExecuteScriptAsync($$"""
                    document.querySelector('[title="{{preset}}% 默认宽度"]').click()
                    """);
                await Task.Delay(30);
                var target = 1080 * preset / 100;
                var checkedLayout = await web.CoreWebView2.ExecuteScriptAsync($$"""
                    (() => {
                      const dom = document.querySelector('.tiptap'), editor = dom.editor;
                      const node = editor.state.selection.node;
                      const nodeDom = editor.view.nodeDOM(editor.state.selection.from);
                      const wrapper = nodeDom.querySelector('.resizable-image-wrapper') || nodeDom;
                      const check = width => {
                        dom.style.width = width + 'px';
                        const displayed = wrapper.getBoundingClientRect().width;
                        if (Math.abs(displayed - Math.min(width, {{target}})) > 1) throw new Error('Image did not clamp or restore: ' + displayed);
                      };
                      check(1600); check({{target - 60}}); check(1600);
                      if (node.attrs.width !== '{{target}}px') throw new Error('Window size changed saved image width');
                      return true;
                    })()
                    """);
                Assert.Equal("true", checkedLayout);
            }
            await Task.Delay(250);
            Assert.True(await vm.FlushAllAsync());
            var stored = await notes.GetAsync(note.Id);
            Assert.Equal(imagePaths.Length, Regex.Matches(stored!.BodyHtml, "<img\\b").Count);
            Assert.Contains("typing while images save", stored.BodyText);
            Assert.Contains("data-image-base-width=\"1080\"", stored.BodyHtml);
            Assert.Contains("data-image-base-width=\"360\"", stored.BodyHtml);
            Assert.Contains("data-image-pixel-height=\"2400\"", stored.BodyHtml);
            Assert.True(ticks > 5);
            Assert.True(maxGap < 500, $"UI heartbeat stalled for {maxGap:F1} ms.");
            heartbeat.Stop();
            Console.WriteLine(JsonSerializer.Serialize(new { screenshots = imagePaths.Length, savedImages = imagePaths.Length,
                typingPreserved = true, layoutChecks, presetsAndNarrowRestore = true,
                uiHeartbeatTicks = ticks, longestUiGapMs = Math.Round(maxGap, 1), localData = directory }));
        }
        finally
        {
            web.Dispose();
            typeof(MainWindow).GetField("_allowClose", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(window, true);
            window.Close();
            app.Shutdown();
        }
    }

    private static async Task WaitForScriptAsync(WebView2 web, string script, string expected)
    {
        var timeout = Stopwatch.StartNew();
        while (timeout.Elapsed < TimeSpan.FromSeconds(10))
        {
            if (await web.CoreWebView2.ExecuteScriptAsync(script) == expected) return;
            await Task.Delay(20);
        }
        throw new TimeoutException($"WebView did not produce {expected} for {script}.");
    }

    private sealed class ProbeLogger : IAppLogger
    {
        public void Info(string message) { }
        public void Error(string message, Exception exception) => Console.Error.WriteLine($"{message}: {exception.Message}");
    }
}

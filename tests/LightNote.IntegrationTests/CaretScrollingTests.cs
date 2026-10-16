using System.Reflection;
using System.Text.Json;
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

namespace LightNote.IntegrationTests;

public sealed class CaretScrollingTests
{
    public void VerifyCaretScrolling()
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
        Assert.True(thread.Join(TimeSpan.FromSeconds(40)), "Caret scrolling blocked the native UI.");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private static async Task RunAsync()
    {
        var directory = Path.Combine(Directory.GetCurrentDirectory(), "tmp", "caret-scrolling-ui", Guid.NewGuid().ToString("N"));
        var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.InitializeComponent();
        var paths = new AppDataPaths(directory);
        var factory = new SqliteConnectionFactory(paths);
        var logger = new ProbeLogger();
        await new SqliteDatabaseInitializer(factory, logger).InitializeAsync();
        var notes = new SqliteNoteRepository(factory);
        var settings = new AppSettingsService(paths);
        var attachments = new AttachmentService(paths, factory, settings);
        var now = DateTimeOffset.UtcNow;
        var note = new Note { Id = "caret-probe", Title = "Caret scrolling probe",
            BodyHtml = string.Concat(Enumerable.Repeat("<p>长笔记正文，验证连续换行。</p>", 45)) + "<p>末尾</p>",
            BodyText = "Caret probe", BodyJson = "{\"type\":\"doc\",\"content\":[]}", CreatedAt = now, UpdatedAt = now };
        await notes.UpsertAsync(note);
        using var http = new HttpClient();
        var vm = new MainViewModel(notes, new SqliteNotebookRepository(factory), logger, attachmentService: attachments);
        var window = new MainWindow(vm, paths, logger, attachments, null!, factory, null!, null!, null!,
            new FirebaseSyncService(paths, factory, http, logger), settings, new ThemeService());
        var root = (FrameworkElement)window.Content;
        window.Content = null;
        root.DataContext = vm;
        using var host = new HwndSource(new HwndSourceParameters("LightNote caret scrolling test")
            { Width = 1400, Height = 850, WindowStyle = unchecked((int)0x80000000) });
        host.RootVisual = root;
        root.Measure(new Size(1400, 850)); root.Arrange(new Rect(0, 0, 1400, 850)); root.UpdateLayout();
        var web = (WebView2)window.FindName("EditorWebView");
        try
        {
            await vm.InitializeAsync();
            vm.SelectedNote = vm.Notes.Single(item => item.Model.Id == note.Id);
            await (Task)typeof(MainWindow).GetMethod("InitializeEditorAsync", BindingFlags.Instance | BindingFlags.NonPublic)!.Invoke(window, null)!;
            for (var attempt = 0; attempt < 250; attempt++)
            {
                if (await web.CoreWebView2.ExecuteScriptAsync("Boolean(document.querySelector('.tiptap')?.editor?.isEditable)") == "true") break;
                await Task.Delay(20);
            }
            var result = await web.CoreWebView2.ExecuteScriptAsync("""
                (() => { try {
                  const dom = document.querySelector('.tiptap'), editor = dom.editor, body = document.body;
                  editor.commands.focus('end');
                  body.scrollTop = body.scrollHeight;
                  const start = body.scrollTop;
                  const bottomGap = () => body.clientHeight - editor.view.coordsAtPos(editor.state.selection.head).bottom;
                  const initialBottomGap = bottomGap();
                  if (initialBottomGap < 20 || initialBottomGap > 36)
                    throw new Error('Bottom gap should be about one line: ' + initialBottomGap);
                  const check = label => {
                    const rect = editor.view.coordsAtPos(editor.state.selection.head);
                    if (rect.top < 0 || rect.bottom > body.clientHeight - 8)
                      throw new Error(label + ': caret hidden ' + JSON.stringify({ top: rect.top, bottom: rect.bottom, height: body.clientHeight, scroll: body.scrollTop, scrollHeight: body.scrollHeight, padding: getComputedStyle(dom).paddingBottom, editorBottom: dom.getBoundingClientRect().bottom, windowScroll: window.scrollY }));
                  };
                  for (let i = 0; i < 25; i++) {
                    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
                    check('Enter ' + i);
                  }
                  if (body.scrollTop <= start + 300) throw new Error('Viewport did not follow new paragraphs');
                  for (let i = 0; i < 10; i++) {
                    dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, shiftKey: true, bubbles: true, cancelable: true }));
                    check('Shift+Enter ' + i);
                  }
                  editor.commands.insertContent('继续输入'); check('Typing');
                  editor.commands.undo(); check('Undo');
                  editor.commands.redo(); check('Redo');
                  body.scrollTop = body.scrollHeight;
                  const finalBottomGap = bottomGap();
                  if (finalBottomGap < 20 || finalBottomGap > 36)
                    throw new Error('Bottom gap grew after editing: ' + finalBottomGap);
                  const endScroll = body.scrollTop;
                  body.scrollTop = 0;
                  editor.view.dispatch(editor.state.tr.setMeta('probe', true));
                  if (body.scrollTop !== 0) throw new Error('Manual reading scroll was reset');
                  editor.commands.setTextSelection(1);
                  body.scrollTop = endScroll;
                  editor.view.dispatch(editor.state.tr.scrollIntoView());
                  check('Scroll back to top');
                  return { passed: true, enter: 25, softBreaks: 10, start, endScroll, initialBottomGap, finalBottomGap, viewportHeight: body.clientHeight };
                } catch(error) { return { passed: false, error: error.message }; } })()
                """);
            Console.WriteLine(result);
            using var parsed = JsonDocument.Parse(result);
            Assert.True(parsed.RootElement.GetProperty("passed").GetBoolean(), result);
        }
        finally
        {
            web.Dispose();
            typeof(MainWindow).GetField("_allowClose", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(window, true);
            window.Close(); app.Shutdown();
        }
    }

    private sealed class ProbeLogger : IAppLogger
    {
        public void Info(string message) { }
        public void Error(string message, Exception exception) => Console.Error.WriteLine($"{message}: {exception.GetType().Name}");
    }
}

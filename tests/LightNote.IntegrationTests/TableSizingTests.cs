using System.Diagnostics;
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

public sealed class TableSizingTests
{
    public void VerifyTableSizing()
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
        Assert.True(thread.Join(TimeSpan.FromSeconds(35)), "Table sizing blocked the native UI.");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private static async Task RunAsync()
    {
        var directory = Path.Combine(Directory.GetCurrentDirectory(), "tmp", "table-sizing-ui", Guid.NewGuid().ToString("N"));
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
        var html = "<table><tr><th>服务器</th><th>运行阶段</th><th>并行数</th></tr>" +
            "<tr><td>40核</td><td>primary_apg、family_apg（含 fresh R），之后跑外部基线</td><td>Jobs 38 BaselineJobs 5</td></tr>" +
            "<tr><td>20核A</td><td>primary_tv，之后跑 family_tv（含 fresh R）</td><td>Jobs 12</td></tr></table>" +
            "<table data-table-width=\"1080\"><tr><th colwidth=\"118\">服务器</th><th colwidth=\"456\">阶段</th><th colwidth=\"506\">并行</th></tr></table>" +
            "<img src=\"https://lightnote.attachments/test.png\" width=\"1080px\" data-image-base-width=\"1080\" data-image-pixel-width=\"2160\" data-image-pixel-height=\"1080\"><p>继续编辑</p>";
        var note = new Note { Id = "table-probe", Title = "Table sizing probe", BodyHtml = html,
            BodyText = "Table sizing probe", BodyJson = "{\"type\":\"doc\",\"content\":[]}", CreatedAt = now, UpdatedAt = now };
        await notes.UpsertAsync(note);
        using var http = new HttpClient();
        var vm = new MainViewModel(notes, new SqliteNotebookRepository(factory), logger, attachmentService: attachments);
        var window = new MainWindow(vm, paths, logger, attachments, null!, factory, null!, null!, null!,
            new FirebaseSyncService(paths, factory, http, logger), settings, new ThemeService());
        var root = (FrameworkElement)window.Content;
        window.Content = null;
        root.DataContext = vm;
        using var host = new HwndSource(new HwndSourceParameters("LightNote table sizing test")
            { Width = 1400, Height = 850, WindowStyle = unchecked((int)0x80000000) });
        host.RootVisual = root;
        root.Measure(new Size(1400, 850)); root.Arrange(new Rect(0, 0, 1400, 850)); root.UpdateLayout();
        var web = (WebView2)window.FindName("EditorWebView");
        try
        {
            await vm.InitializeAsync();
            vm.SelectedNote = vm.Notes.Single(item => item.Model.Id == note.Id);
            var initialize = typeof(MainWindow).GetMethod("InitializeEditorAsync", BindingFlags.Instance | BindingFlags.NonPublic)!;
            await (Task)initialize.Invoke(window, null)!;
            for (var attempt = 0; attempt < 250; attempt++)
            {
                if (await web.CoreWebView2.ExecuteScriptAsync("Boolean(document.querySelector('.tiptap')?.editor?.isEditable)") == "true") break;
                await Task.Delay(20);
            }
            await Task.Delay(100);
            Assert.Equal("true", await CheckedScriptAsync(web, """
                (() => {
                  const dom = document.querySelector('.tiptap'), editor = dom.editor;
                  window.tableProbeWidths = () => editor.getJSON().content[0].content[0].content.flatMap(cell => cell.attrs.colwidth);
                  const initial = tableProbeWidths();
                  if (initial.reduce((a,b) => a+b) !== 900 || initial[0] >= initial[1]) throw new Error('Auto-sizing failed');
                  const legacy = editor.getJSON().content[1];
                  if (legacy.attrs.tableWidth !== 900 || JSON.stringify(legacy.content[0].content.flatMap(cell => cell.attrs.colwidth)) !== '[98,380,422]') throw new Error('Old default was not scaled proportionally');
                  const autoHeight = dom.querySelector('table').getBoundingClientRect().height;
                  editor.commands.equalizeTableColumns();
                  const equalHeight = dom.querySelector('table').getBoundingClientRect().height;
                  editor.commands.undo();
                  if (autoHeight >= equalHeight) throw new Error('Example wrapping did not improve');
                  window.tableProbeInitialMetrics = { initial, autoHeight, equalHeight };
                  for (const width of [1600, 450, 1200]) {
                    dom.style.width = width + 'px';
                    if (Math.abs(dom.querySelector('table').getBoundingClientRect().width - 900) > 1) throw new Error('Table follows viewport');
                    const image = dom.querySelector('.resizable-image-wrapper');
                    if (image.style.width !== '1080px' || Math.abs(image.getBoundingClientRect().width - Math.min(width, 1080)) > 1) throw new Error('Image 1080 rule changed');
                  }
                  dom.style.width='940px';
                  const wrapper=dom.querySelector('.tableWrapper');
                  if (wrapper.scrollWidth > wrapper.clientWidth + 1) throw new Error('900 table does not fit 940 viewport');
                  dom.style.width = '1200px'; editor.commands.setTextSelection(4);
                  return true;
                })()
                """));
            await Task.Delay(30);
            await web.CoreWebView2.ExecuteScriptAsync("[...document.querySelectorAll('.table-bar button')].find(b => b.textContent === '列宽').click()");
            await Task.Delay(30);
            Assert.Equal("true", await CheckedScriptAsync(web, """
                (() => {
                  const input = document.querySelector('.table-width-panel input');
                  if (!input) throw new Error('No numeric width control');
                  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '135');
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  return true;
                })()
                """));
            await Task.Delay(30);
            await web.CoreWebView2.ExecuteScriptAsync("[...document.querySelectorAll('.table-width-panel button')].find(b => b.textContent === '应用列宽').click()");
            await Task.Delay(30);
            Assert.Equal("true", await web.CoreWebView2.ExecuteScriptAsync("tableProbeWidths()[0] === 135"));
            Assert.Equal("true", await CheckedScriptAsync(web, """
                (() => {
                  const dom = document.querySelector('.tiptap'), editor = dom.editor;
                  editor.commands.setTextSelection(4 + editor.state.doc.child(0).child(0).child(0).nodeSize);
                  editor.commands.setTableColumnWidth(450);
                  if (JSON.stringify(tableProbeWidths()) !== '[135,450,315]') throw new Error('Preset proportions failed');
                  window.tableProbeBeforeDrag = editor.getJSON();
                  const cell = dom.querySelector('th'), rect = cell.getBoundingClientRect();
                  const mouse = (target,type,x) => target.dispatchEvent(new MouseEvent(type, {clientX:x, clientY:rect.top+12, button:0, buttons:1, bubbles:true,cancelable:true}));
                  mouse(cell,'mousemove',rect.right-2);
                  if (!dom.classList.contains('resize-cursor') || !dom.querySelector('.column-resize-handle')) throw new Error('No resize feedback');
                  if (getComputedStyle(dom.querySelector('.column-resize-handle')).width !== '3px') throw new Error('Inner highlight is not 3px');
                  mouse(cell,'mousedown',rect.right-2); mouse(window,'mousemove',rect.right-42);
                  if (JSON.stringify(editor.getJSON()) !== JSON.stringify(tableProbeBeforeDrag)) throw new Error('Drag wrote the document before release');
                  if (Math.abs(dom.querySelector('table').getBoundingClientRect().width-900)>1) throw new Error('Drag changed total');
                  mouse(window,'mouseup',rect.right-42);
                  if (JSON.stringify(tableProbeWidths()) !== '[95,490,315]') throw new Error('Adjacent resizing failed');
                  editor.commands.undo();
                  if (JSON.stringify(tableProbeWidths()) !== '[135,450,315]') throw new Error('Undo did not restore resize');
                  editor.commands.redo();
                  editor.commands.equalizeTableColumns();
                  if (JSON.stringify(tableProbeWidths()) !== '[300,300,300]') throw new Error('Equalize failed');
                  editor.commands.undo();
                  if (JSON.stringify(tableProbeWidths()) !== '[95,490,315]') throw new Error('Equalize undo failed');
                  dom.style.width='450px';
                  const wrapper=dom.querySelector('.tableWrapper');
                  if (wrapper.scrollWidth <= wrapper.clientWidth) throw new Error('No horizontal scrolling');
                  wrapper.scrollLeft=100;
                  if (wrapper.scrollLeft < 90) throw new Error('Cannot scroll table');
                  dom.style.width='1200px';
                  editor.commands.equalizeTableColumns();
                  const last = dom.querySelectorAll('th')[2], edge = last.getBoundingClientRect();
                  const tableLeft = dom.querySelector('table').getBoundingClientRect().left;
                  const beforeOuter = JSON.stringify(editor.getJSON());
                  mouse(last,'mousemove',edge.right-2);
                  if (!dom.classList.contains('resize-cursor') || !last.querySelector('.column-resize-handle')) throw new Error('No outer resize feedback');
                  if (getComputedStyle(last.querySelector('.column-resize-handle')).width !== '3px') throw new Error('Outer highlight is not 3px');
                  mouse(last,'mousedown',edge.right-2); mouse(window,'mousemove',edge.right-182);
                  if (JSON.stringify(editor.getJSON()) !== beforeOuter) throw new Error('Outer preview wrote document');
                  if (Math.abs(dom.querySelector('table').getBoundingClientRect().width-720)>1) throw new Error('Outer preview did not shrink table');
                  const previewWidths=[...dom.querySelectorAll('col')].slice(0,3).map(col=>col.style.width);
                  if (JSON.stringify(previewWidths) !== '["300px","300px","120px"]') throw new Error('Outer preview changed earlier columns');
                  mouse(window,'mouseup',edge.right-182);
                  if (JSON.stringify(tableProbeWidths()) !== '[300,300,120]') throw new Error('Outer resize changed earlier columns');
                  if (editor.getJSON().content[0].attrs.tableWidthMode !== 'fixed') throw new Error('Custom total not marked fixed');
                  if (Math.abs(dom.querySelector('table').getBoundingClientRect().left-tableLeft)>1) throw new Error('Outer resize moved left edge');
                  editor.commands.undo();
                  if (JSON.stringify(tableProbeWidths()) !== '[300,300,300]') throw new Error('Outer undo failed');
                  editor.commands.redo();
                  if (JSON.stringify(tableProbeWidths()) !== '[300,300,120]') throw new Error('Outer redo failed');
                  const nextEdge=last.getBoundingClientRect();
                  mouse(last,'mousemove',nextEdge.right-2); mouse(last,'mousedown',nextEdge.right-2);
                  mouse(window,'mousemove',nextEdge.right+198);
                  window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
                  if (Math.abs(dom.querySelector('table').getBoundingClientRect().width-720)>1 || JSON.stringify(tableProbeWidths()) !== '[300,300,120]') throw new Error('Outer cancel failed');
                  editor.chain().focus('end').insertContent('列宽调整后继续输入').run();
                  return true;
                })()
                """));
            await Task.Delay(260);
            Assert.True(await vm.FlushAllAsync());
            var stored = (await notes.GetAsync(note.Id))!;
            Assert.Contains("colwidth=\"120\"", stored.BodyHtml);
            Assert.Contains("data-table-width=\"720\"", stored.BodyHtml);
            Assert.Contains("data-table-width-mode=\"fixed\"", stored.BodyHtml);
            Assert.Contains("列宽调整后继续输入", stored.BodyText);
            Assert.Equal("true", await CheckedScriptAsync(web, $$"""
                (() => {
                  const editor=document.querySelector('.tiptap').editor;
                  editor.commands.setContent({{JsonSerializer.Serialize(stored.BodyHtml)}});
                  if (JSON.stringify(tableProbeWidths()) !== '[300,300,120]' || editor.getJSON().content[0].attrs.tableWidth !== 720) throw new Error('Reopening lost custom total');
                  const legacy=editor.getJSON().content[1];
                  if (legacy.attrs.tableWidth !== 900 || JSON.stringify(legacy.content[0].content.flatMap(cell=>cell.attrs.colwidth)) !== '[98,380,422]') throw new Error('Old table was scaled again');
                  return true;
                })()
                """));
            Console.WriteLine("Initial layout: " + await web.CoreWebView2.ExecuteScriptAsync("tableProbeInitialMetrics"));
            Console.WriteLine(JsonSerializer.Serialize(new { autoSizing = true, defaultWidth = 900, customWidth = 720, outerDrag = true, precedingColumnsPreserved = true, highlightPixels = 3, old1080Migration = true, image1080Preserved = true,
                numericControl = true, adjacentDrag = true, undoRedo = true, narrowScroll = true,
                savedAndReopened = true, localData = directory }));
        }
        finally
        {
            web.Dispose();
            typeof(MainWindow).GetField("_allowClose", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(window, true);
            window.Close(); app.Shutdown();
        }
    }

    private static Task<string> CheckedScriptAsync(WebView2 web, string script) =>
        web.CoreWebView2.ExecuteScriptAsync($$"""
            (() => { try { return eval({{JsonSerializer.Serialize(script)}}); }
              catch(error) { return 'SCRIPT FAILED: ' + error.message; } })()
            """);

    private sealed class ProbeLogger : IAppLogger
    {
        public void Info(string message) { }
        public void Error(string message, Exception exception) => Console.Error.WriteLine($"{message}: {exception.GetType().Name}");
    }
}

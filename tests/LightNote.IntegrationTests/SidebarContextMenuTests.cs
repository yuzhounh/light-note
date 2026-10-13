using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using LightNote.App;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;
using LightNote.Infrastructure.Sync;

namespace LightNote.IntegrationTests;

public sealed class SidebarContextMenuTests
{
    [Fact]
    public void RealSidebarRoutesRowTextBackgroundButtonsAndKeyboardWithoutChangingSelection()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            var directory = Path.Combine(Path.GetTempPath(), "LightNote.Tests", Guid.NewGuid().ToString("N"));
            MainWindow? window = null;
            ContextMenu? opened = null;
            try
            {
                var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
                app.InitializeComponent();
                var paths = new AppDataPaths(directory);
                var factory = new SqliteConnectionFactory(paths);
                var logger = new NullLogger();
                new SqliteDatabaseInitializer(factory, logger).InitializeAsync().GetAwaiter().GetResult();
                var notes = new SqliteNoteRepository(factory);
                var notebooks = new SqliteNotebookRepository(factory);
                var now = DateTimeOffset.UtcNow;
                notebooks.UpsertGroupAsync(new NotebookGroup
                {
                    Id = "group", Name = "工作", CreatedAt = now, UpdatedAt = now,
                }).GetAwaiter().GetResult();
                notebooks.UpsertAsync(new Notebook
                {
                    Id = "notebook", Name = "项目", CreatedAt = now, UpdatedAt = now,
                }).GetAwaiter().GetResult();
                notebooks.AssignToGroupAsync("notebook", "group").GetAwaiter().GetResult();
                var settings = new AppSettingsService(paths);
                settings.Save(new AppSettings { ShowRecentNavigation = true, ShowTrashNavigation = true, ShowUnfiledNavigation = true });
                using var httpClient = new HttpClient();
                var vm = new MainViewModel(notes, notebooks, logger);
                window = new MainWindow(vm, paths, logger, null!, null!, factory, null!, null!, null!,
                    new FirebaseSyncService(paths, factory, httpClient, logger), settings, new ThemeService());
                vm.InitializeAsync().GetAwaiter().GetResult();
                var list = (ListBox)window.FindName("NotebookList");
                var root = (FrameworkElement)window.Content;
                window.Content = null;
                root.DataContext = vm;
                using var host = new System.Windows.Interop.HwndSource(new System.Windows.Interop.HwndSourceParameters("LightNote sidebar test")
                {
                    Width = 1180, Height = 760, WindowStyle = unchecked((int)0x80000000),
                });
                host.RootVisual = root;
                VirtualizingPanel.SetIsVirtualizing(list, false);
                Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
                root.Measure(new Size(1180, 760));
                root.Arrange(new Rect(0, 0, 1180, 760));
                root.UpdateLayout();
                Assert.Null(window.FindName("SidebarNewNoteButton"));
                var newNoteButton = Assert.IsType<Button>(window.FindName("NoteListNewNoteButton"));
                Assert.Equal(38, newNoteButton.ActualWidth);
                Assert.Equal(38, newNoteButton.ActualHeight);
                Assert.True(newNoteButton.IsEnabled);
                Assert.Same(vm.NewNoteCommand, newNoteButton.Command);
                Assert.Same(window.FindName("NoteListSearchRow"), newNoteButton.Parent);
                var shortcut = Assert.Single(window.InputBindings.OfType<System.Windows.Input.KeyBinding>(),
                    binding => binding.Key == System.Windows.Input.Key.N && binding.Modifiers == System.Windows.Input.ModifierKeys.Control);
                Assert.Same(vm.NewNoteCommand, shortcut.Command);
                var initialSelection = vm.SelectedNotebook;

                void Open(FrameworkElement source, bool keyboard = false)
                {
                    opened = null;
                    // WPF exposes these routed event args through an internal constructor.
                    var args = (ContextMenuEventArgs)Activator.CreateInstance(typeof(ContextMenuEventArgs),
                        BindingFlags.Instance | BindingFlags.NonPublic, null,
                        [source, true, keyboard ? -1d : 10d, keyboard ? -1d : 10d], null)!;
                    source.RaiseEvent(args);
                    Dispatcher.CurrentDispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
                    Assert.True(args.Handled);
                    DependencyObject? target = source;
                    while (target is not null)
                    {
                        if (target is FrameworkElement { ContextMenu: { } contextMenu })
                        {
                            opened = contextMenu;
                            break;
                        }
                        target = VisualTreeHelper.GetParent(target);
                    }
                    Assert.NotNull(opened);
                    Assert.True(opened.IsOpen);
                    Assert.Equal(keyboard ? System.Windows.Controls.Primitives.PlacementMode.Bottom
                        : System.Windows.Controls.Primitives.PlacementMode.MousePoint, opened.Placement);
                    Assert.Same(initialSelection, vm.SelectedNotebook);
                }

                void Close()
                {
                    opened!.IsOpen = false;
                    var frame = new DispatcherFrame();
                    var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
                    timer.Tick += (_, _) => { timer.Stop(); frame.Continue = false; };
                    timer.Start();
                    Dispatcher.PushFrame(frame);
                }

                foreach (var item in vm.Notebooks)
                {
                    var row = Assert.IsType<ListBoxItem>(list.ItemContainerGenerator.ContainerFromItem(item));
                    Open(row, keyboard: true);
                    Assert.Same(row, opened!.PlacementTarget);
                    var headers = opened.Items.OfType<MenuItem>().Select(entry => entry.Header.ToString()).ToArray();
                    Assert.Contains(item.Kind switch
                    {
                        NotebookKind.Group => "删除笔记本组…",
                        NotebookKind.User => "删除笔记本…",
                        NotebookKind.GroupRoot => "新建笔记本组",
                        NotebookKind.All => "新建笔记",
                        NotebookKind.Unfiled => "新建未归类笔记",
                        _ => "隐藏此入口",
                    }, headers);
                    Assert.True(MainWindow.GetIsSidebarContextTarget(row));
                    Close();
                    Assert.False(MainWindow.GetIsSidebarContextTarget(row));
                    Open(FindText(row)!);
                    Assert.Same(row, opened!.PlacementTarget);
                    Close();
                }

                Open((FrameworkElement)window.FindName("SidebarPanel"));
                var navigation = opened!.Items.OfType<MenuItem>().Single(item => Equals(item.Header, "显示导航项"));
                Assert.All(navigation.Items.OfType<MenuItem>(), item => Assert.True(item.IsChecked));
                navigation.IsSubmenuOpen = true;
                navigation.ApplyTemplate();
                var popup = Assert.IsType<System.Windows.Controls.Primitives.Popup>(navigation.Template.FindName("PART_Popup", navigation));
                Assert.True(popup.IsOpen);
                navigation.IsSubmenuOpen = false;
                Close();
                foreach (var (name, header) in new[]
                {
                    ("SidebarSettingsButton", "打开设置"), ("AccountButton", "Google 登录"),
                })
                {
                    Open((FrameworkElement)window.FindName(name));
                    Assert.Equal(header, Assert.IsType<MenuItem>(Assert.Single(opened!.Items)).Header);
                    Close();
                }
            }
            catch (Exception exception)
            {
                failure = exception;
            }
            finally
            {
                if (opened is not null) opened.IsOpen = false;
                if (window is not null)
                {
                    typeof(MainWindow).GetField("_allowClose", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(window, true);
                    window.Close();
                }
                Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
                if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(30)), "Sidebar smoke test timed out.");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private static TextBlock? FindText(DependencyObject root)
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(root); index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is TextBlock text) return text;
            if (FindText(child) is { } found) return found;
        }
        return null;
    }

    private sealed class NullLogger : IAppLogger
    {
        public void Info(string message) { }
        public void Error(string message, Exception exception) { }
    }
}

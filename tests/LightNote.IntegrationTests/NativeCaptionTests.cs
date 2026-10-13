using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using LightNote.App;
using Microsoft.UI.Windowing;

namespace LightNote.IntegrationTests;

public sealed class NativeCaptionTests
{
    public void VerifyWindowControlsAndCancelableClose()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            app.InitializeComponent();
            new ThemeService().Apply("light");
            var bar = new WindowTitleBar();
            var text = new TextBox { Text = "正文", AcceptsReturn = true };
            var content = new DockPanel();
            DockPanel.SetDock(bar, Dock.Top);
            content.Children.Add(bar);
            content.Children.Add(text);
            var window = new Window { Title = "LightNote caption verification", Width = 700, Height = 500,
                Content = content, Opacity = 0, ShowActivated = false };
            bool cancelFirstClose = true;
            window.Closing += (_, e) =>
            {
                if (!cancelFirstClose) return;
                cancelFirstClose = false;
                e.Cancel = true;
            };
            window.Loaded += (_, _) => window.Dispatcher.BeginInvoke(() =>
            {
                try
                {
                    Assert.True(bar.UsesTallNativeTitleBar, bar.InitializationError);
                    var native = AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(new WindowInteropHelper(window).Handle));
                    var presenter = Assert.IsType<OverlappedPresenter>(native.Presenter);
                    Assert.True(presenter.IsMinimizable);
                    Assert.True(presenter.IsMaximizable);
                    Console.WriteLine($"Native Tall logical height: {bar.Height}");
                    presenter.Maximize();
                    Drain(window);
                    Assert.Equal(WindowState.Maximized, window.WindowState);
                    presenter.Restore();
                    Drain(window);
                    Assert.Equal(WindowState.Normal, window.WindowState);
                    presenter.Minimize();
                    Drain(window);
                    Assert.Equal(WindowState.Minimized, window.WindowState);
                    presenter.Restore();
                    Drain(window);
                    Assert.Equal(WindowState.Normal, window.WindowState);
                    text.AppendText("\n仍可编辑");
                    Assert.Equal("正文\n仍可编辑", text.Text);
                    SystemCommands.CloseWindow(window);
                    Drain(window);
                    Assert.True(window.IsVisible, "WPF must be able to cancel closing for save or tray handling.");
                    Assert.False(cancelFirstClose);
                    SystemCommands.CloseWindow(window);
                }
                catch (Exception exception)
                {
                    failure = exception;
                    cancelFirstClose = false;
                    window.Close();
                }
            });
            try { window.ShowDialog(); }
            catch (Exception exception) { failure = exception; }
            app.Shutdown();
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(15)), "Native caption verification timed out.");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private static void Drain(Window window) => window.Dispatcher.Invoke(() => { }, DispatcherPriority.ApplicationIdle);
}

using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using LightNote.App;

namespace LightNote.IntegrationTests;

public sealed class MessageDialogTests
{
    [Fact]
    public void ThemedModalPreservesConfirmationDismissalAndLongMessageBehavior()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                _ = Microsoft.UI.Windowing.AppWindowTitleBar.IsCustomizationSupported();
            }
            catch (Exception exception)
            {
                failure = exception;
                return;
            }
            var app = new LightNote.App.App(runRuntimeStartup: false) { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            try
            {
                app.InitializeComponent();
                var theme = new ThemeService();
                foreach (var preference in new[] { "light", "dark" })
                {
                    theme.Apply(preference);
                    foreach (var (buttons, choice, expected) in new (MessageBoxButton, MessageBoxResult?, MessageBoxResult)[]
                    {
                        (MessageBoxButton.YesNo, MessageBoxResult.Yes, MessageBoxResult.Yes),
                        (MessageBoxButton.YesNo, MessageBoxResult.No, MessageBoxResult.No),
                        (MessageBoxButton.YesNo, null, MessageBoxResult.No),
                        (MessageBoxButton.OKCancel, null, MessageBoxResult.Cancel),
                        (MessageBoxButton.YesNoCancel, MessageBoxResult.Cancel, MessageBoxResult.Cancel),
                        (MessageBoxButton.OK, MessageBoxResult.OK, MessageBoxResult.OK),
                    })
                    {
                        var dialog = new MessageDialog("删除笔记本？笔记会保留。", "LightNote", buttons,
                            MessageBoxImage.Question, buttons == MessageBoxButton.YesNo ? MessageBoxResult.No : MessageBoxResult.None)
                        { Opacity = 0, ShowActivated = false };
                        dialog.Loaded += (_, _) =>
                        {
                            try
                            {
                                Assert.Equal(WindowStyle.SingleBorderWindow, dialog.WindowStyle);
                                Assert.Same(app.Resources["AppBackgroundBrush"], dialog.Background);
                                var titleBar = Assert.IsType<WindowTitleBar>(FindTitleBar(dialog));
                                Assert.False(titleBar.ShowMinMax);
                                Assert.True(titleBar.UsesTallNativeTitleBar, titleBar.InitializationError);
                                var native = Microsoft.UI.Windowing.AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(
                                    new System.Windows.Interop.WindowInteropHelper(dialog).Handle));
                                Assert.True(native.TitleBar.ExtendsContentIntoTitleBar);
                                Assert.Equal(Microsoft.UI.Windowing.TitleBarHeightOption.Tall, native.TitleBar.PreferredHeightOption);
                                Assert.Equal(native.TitleBar.Height / VisualTreeHelper.GetDpi(dialog).DpiScaleY, titleBar.Height, precision: 1);
                                var presenter = Assert.IsType<Microsoft.UI.Windowing.OverlappedPresenter>(native.Presenter);
                                Assert.False(presenter.IsMinimizable);
                                Assert.False(presenter.IsMaximizable);
                                var panel = (StackPanel)dialog.FindName("ButtonPanel");
                                var defaultButton = Assert.Single(panel.Children.OfType<Button>(), button => button.IsDefault);
                                if (buttons == MessageBoxButton.YesNo)
                                {
                                    Assert.Equal(MessageBoxResult.No, defaultButton.Tag);
                                }
                                if (choice is { } result)
                                {
                                    panel.Children.OfType<Button>().Single(button => Equals(button.Tag, result))
                                        .RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
                                }
                                else
                                {
                                    SystemCommands.CloseWindow(dialog);
                                }
                            }
                            catch (Exception exception)
                            {
                                failure = exception;
                                dialog.Close();
                            }
                        };
                        dialog.ShowDialog();
                        if (failure is not null) throw failure;
                        Assert.Equal(expected, dialog.Result);
                    }

                    var longDialog = new MessageDialog(string.Join('\n', Enumerable.Repeat(new string('字', 100), 100)),
                        "导入完成", MessageBoxButton.YesNo, MessageBoxImage.Information, MessageBoxResult.No)
                    { Opacity = 0, ShowActivated = false };
                    longDialog.Loaded += (_, _) =>
                    {
                        try
                        {
                            Assert.True(longDialog.ActualHeight <= longDialog.MaxHeight + 1);
                            var escape = new KeyEventArgs(Keyboard.PrimaryDevice, PresentationSource.FromVisual(longDialog), 0, Key.Escape)
                            { RoutedEvent = Keyboard.PreviewKeyDownEvent };
                            longDialog.RaiseEvent(escape);
                            Assert.True(escape.Handled);
                        }
                        catch (Exception exception)
                        {
                            failure = exception;
                            longDialog.Close();
                        }
                    };
                    longDialog.ShowDialog();
                    if (failure is not null) throw failure;
                    Assert.Equal(MessageBoxResult.No, longDialog.Result);
                }
            }
            catch (Exception exception)
            {
                failure = exception;
            }
            finally
            {
                app.Shutdown();
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(30)), "Message dialog smoke test timed out.");
        if (failure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(failure).Throw();
    }

    private static WindowTitleBar? FindTitleBar(DependencyObject root)
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(root); index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is WindowTitleBar titleBar) return titleBar;
            if (FindTitleBar(child) is { } found) return found;
        }
        return null;
    }
}

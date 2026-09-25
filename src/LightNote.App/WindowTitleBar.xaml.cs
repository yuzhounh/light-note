using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;

namespace LightNote.App;

public partial class WindowTitleBar : UserControl
{
    public WindowTitleBar()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            if (Window.GetWindow(this) is { } window)
            {
                window.StateChanged += (_, _) => UpdateMaximizeIcon(window);
                window.Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(window);
                WindowNativeHelper.ApplyNativeFrame(window);
                UpdateMaximizeIcon(window);
            }
        };
    }

    private void OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (Window.GetWindow(this) is not { } window)
        {
            return;
        }

        if (e.ClickCount == 2 && window.ResizeMode is ResizeMode.CanResize or ResizeMode.CanResizeWithGrip)
        {
            ToggleMaximize(window);
            return;
        }

        if (e.LeftButton == MouseButtonState.Pressed)
        {
            window.DragMove();
        }
    }

    private void OnMinimizeClick(object sender, RoutedEventArgs e)
    {
        if (Window.GetWindow(this) is { } window)
        {
            SystemCommands.MinimizeWindow(window);
        }
    }

    private void OnMaximizeClick(object sender, RoutedEventArgs e)
    {
        if (Window.GetWindow(this) is { } window)
        {
            ToggleMaximize(window);
        }
    }

    private void OnCloseClick(object sender, RoutedEventArgs e)
    {
        if (Window.GetWindow(this) is { } window)
        {
            SystemCommands.CloseWindow(window);
        }
    }

    private static void ToggleMaximize(Window window)
    {
        if (window.ResizeMode is ResizeMode.NoResize or ResizeMode.CanMinimize)
        {
            return;
        }

        if (window.WindowState == WindowState.Maximized)
        {
            SystemCommands.RestoreWindow(window);
        }
        else
        {
            SystemCommands.MaximizeWindow(window);
        }
    }

    private void UpdateMaximizeIcon(Window window)
    {
        MaximizeIcon.Data = System.Windows.Media.Geometry.Parse(
            window.WindowState == WindowState.Maximized
                ? "M2.5,0.5 H10.5 V8.5 H8.5 M0.5,2.5 H8.5 V10.5 H0.5 Z"
                : "M0.5,0.5 H10.5 V10.5 H0.5 Z");
    }
}

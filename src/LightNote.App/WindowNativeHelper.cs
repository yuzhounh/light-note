using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace LightNote.App;

internal static class WindowNativeHelper
{
    private const int DwmWindowAttributeNcRenderingPolicy = 2;
    private const int DwmNcRenderingEnabled = 2;
    private const int DwmWindowAttributeCornerPreference = 33;
    private const int DwmWindowCornerPreferenceRound = 2;
    private const int DwmWindowAttributeUseImmersiveDarkMode = 20;
    private const int DwmWindowAttributeUseImmersiveDarkModeBefore20H1 = 19;

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(
        IntPtr windowHandle,
        int attribute,
        ref int attributeValue,
        int attributeSize);

    public static void ApplyNativeFrame(Window window)
    {
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == IntPtr.Zero)
        {
            return;
        }

        var isDark = false;
        if (HwndSource.FromHwnd(handle) is { CompositionTarget: { } compositionTarget })
        {
            if (window.Background is SolidColorBrush backgroundBrush)
            {
                compositionTarget.BackgroundColor = backgroundBrush.Color;
                isDark = (backgroundBrush.Color.R * 0.299 + backgroundBrush.Color.G * 0.587 + backgroundBrush.Color.B * 0.114) < 128;
            }
            else if (Application.Current?.TryFindResource("AppBackgroundBrush") is SolidColorBrush appBrush)
            {
                compositionTarget.BackgroundColor = appBrush.Color;
                isDark = (appBrush.Color.R * 0.299 + appBrush.Color.G * 0.587 + appBrush.Color.B * 0.114) < 128;
            }
        }

        try
        {
            var renderingPolicy = DwmNcRenderingEnabled;
            _ = DwmSetWindowAttribute(
                handle,
                DwmWindowAttributeNcRenderingPolicy,
                ref renderingPolicy,
                sizeof(int));

            var cornerPreference = DwmWindowCornerPreferenceRound;
            _ = DwmSetWindowAttribute(
                handle,
                DwmWindowAttributeCornerPreference,
                ref cornerPreference,
                sizeof(int));

            var darkMode = isDark ? 1 : 0;
            if (DwmSetWindowAttribute(handle, DwmWindowAttributeUseImmersiveDarkMode, ref darkMode, sizeof(int)) != 0)
            {
                _ = DwmSetWindowAttribute(handle, DwmWindowAttributeUseImmersiveDarkModeBefore20H1, ref darkMode, sizeof(int));
            }
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }

    public static void ApplyImmersiveDarkMode(Window window, bool isDark)
    {
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == IntPtr.Zero)
        {
            return;
        }

        try
        {
            var darkMode = isDark ? 1 : 0;
            if (DwmSetWindowAttribute(handle, DwmWindowAttributeUseImmersiveDarkMode, ref darkMode, sizeof(int)) != 0)
            {
                _ = DwmSetWindowAttribute(handle, DwmWindowAttributeUseImmersiveDarkModeBefore20H1, ref darkMode, sizeof(int));
            }
        }
        catch
        {
        }
    }
}

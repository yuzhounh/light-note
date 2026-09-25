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

        if (HwndSource.FromHwnd(handle) is { CompositionTarget: { } compositionTarget })
        {
            if (window.Background is SolidColorBrush backgroundBrush)
            {
                compositionTarget.BackgroundColor = backgroundBrush.Color;
            }
            else if (Application.Current?.TryFindResource("AppBackgroundBrush") is SolidColorBrush appBrush)
            {
                compositionTarget.BackgroundColor = appBrush.Color;
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
        }
        catch (DllNotFoundException)
        {
        }
        catch (EntryPointNotFoundException)
        {
        }
    }
}

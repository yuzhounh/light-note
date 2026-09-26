using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;

namespace LightNote.App;

public sealed class ThemeService
{
    public bool IsDark { get; private set; }

    public void Apply(string preference)
    {
        IsDark = preference == "dark" || (preference == "system" && SystemUsesDarkTheme());

        SetBrush("AppBackgroundBrush", IsDark ? "#FF17191C" : "#FFF7F8FA");
        SetBrush("PanelBrush", IsDark ? "#FF202328" : "#FFFFFFFF");
        SetBrush("SecondaryPanelBrush", IsDark ? "#FF292D32" : "#FFF1F3F5");
        SetBrush("BorderBrush", IsDark ? "#FF3B4148" : "#FFE2E5E9");
        SetBrush("TextBrush", IsDark ? "#FFF2F4F7" : "#FF1F2328");
        SetBrush("MutedTextBrush", IsDark ? "#FFAAB2BC" : "#FF68717D");
        SetBrush("AccentBrush", IsDark ? "#FF3B82F6" : "#FF246BFD");
        SetBrush("AccentLightBrush", IsDark ? "#FF2A374A" : "#FFDCEEFF");
        SetBrush("ToolbarActiveBackgroundBrush", IsDark ? "#FF404B5C" : "#FFDCEEFF");
        SetBrush("ToolbarActiveForegroundBrush", IsDark ? "#FFFFFFFF" : "#FF1D4ED8");
        SetBrush("ToolbarActiveBorderBrush", IsDark ? "#FF64748B" : "#FF93C5FD");
        SetBrush("ToolTipBackgroundBrush", IsDark ? "#FF2B3037" : "#FF1F2328");
        SetBrush("ToolTipForegroundBrush", IsDark ? "#FFF3F4F6" : "#FFFFFFFF");
        SetBrush("ToolTipBorderBrush", IsDark ? "#FF4B5563" : "#FF374151");
        SetBrush("ScrollBarThumbBrush", IsDark ? "#FF3B4148" : "#FFE2E5E9");
        SetBrush("ScrollBarThumbHoverBrush", IsDark ? "#FF4E555E" : "#FFCBD0D6");
        SetBrush("ScrollBarThumbDragBrush", IsDark ? "#FF656D78" : "#FFAAB2BC");
    }

    private static bool SystemUsesDarkTheme()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int value && value == 0;
        }
        catch
        {
            return false;
        }
    }

    private static void SetBrush(string resourceKey, string color)
    {
        var parsedColor = (Color)ColorConverter.ConvertFromString(color);
        if (Application.Current.Resources[resourceKey] is SolidColorBrush brush && !brush.IsFrozen)
        {
            brush.Color = parsedColor;
            return;
        }

        Application.Current.Resources[resourceKey] = new SolidColorBrush(parsedColor);
    }
}

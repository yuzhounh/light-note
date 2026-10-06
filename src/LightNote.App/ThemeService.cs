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
        SetBrush("BorderBrush", IsDark ? "#FF2F343A" : "#FFEEF0F2");
        SetBrush("NewNoteButtonBrush", IsDark ? "#FF2C3036" : "#FFEAECEF");
        SetBrush("NewNoteButtonHoverBrush", IsDark ? "#FF363B43" : "#FFDFE3E8");
        SetBrush("NewNoteButtonBorderBrush", IsDark ? "#FF3E444D" : "#FFD8DCE0");
        SetBrush("TextBrush", IsDark ? "#FFF2F4F7" : "#FF1F2328");
        SetBrush("MutedTextBrush", IsDark ? "#FFC4CAD1" : "#FF68717D");
        SetBrush("AccentBrush", IsDark ? "#FF3B82F6" : "#FF246BFD");
        SetBrush("AccentLightBrush", IsDark ? "#FF2A374A" : "#FFE8F0FE");
        SetBrush("ListItemSelectedBackgroundBrush", IsDark ? "#FF253244" : "#FFE8F0FE");
        SetBrush("ListItemSelectedBorderBrush", IsDark ? "#FF3E5C85" : "#FFA0C5FD");
        SetBrush("ToolbarHoverBackgroundBrush", IsDark ? "#FF3A424E" : "#FFE8ECF1");
        SetBrush("ToolbarActiveBackgroundBrush", IsDark ? "#FF556073" : "#FFDCEEFF");
        SetBrush("ToolbarActiveForegroundBrush", IsDark ? "#FFFFFFFF" : "#FF1D4ED8");
        SetBrush("ToolbarActiveBorderBrush", IsDark ? "#FF6E7B91" : "#FF93C5FD");
        SetBrush("ToolTipBackgroundBrush", IsDark ? "#FF2B3037" : "#FFFFFFFF");
        SetBrush("ToolTipForegroundBrush", IsDark ? "#FFF3F4F6" : "#FF1F2328");
        SetBrush("ToolTipBorderBrush", IsDark ? "#FF4B5563" : "#FFEEF0F2");
        SetBrush("ScrollBarThumbBrush", IsDark ? "#FF2F343A" : "#FFEEF0F2");
        SetBrush("ScrollBarThumbHoverBrush", IsDark ? "#FF3F454D" : "#FFDDE1E5");
        SetBrush("ScrollBarThumbDragBrush", IsDark ? "#FF525963" : "#FFC4CAD1");
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

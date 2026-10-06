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
        SetBrush("NavHoverBackgroundBrush", IsDark ? "#FF363B43" : "#FFE4E7EB");
        SetBrush("NavSelectedBackgroundBrush", IsDark ? "#FF234A3F" : "#FFD3F0E3");
        SetBrush("NavSelectedForegroundBrush", IsDark ? "#FF34D399" : "#FF007F55");
        SetBrush("TextBrush", IsDark ? "#FFF2F4F7" : "#FF1F2328");
        SetBrush("MutedTextBrush", IsDark ? "#FFC4CAD1" : "#FF68717D");
        SetBrush("AccentBrush", IsDark ? "#FF34D399" : "#FF009467");
        SetBrush("AccentSolidBrush", IsDark ? "#FF0E8F66" : "#FF009467");
        SetBrush("AccentSolidHoverBrush", IsDark ? "#FF0B7A58" : "#FF007F55");
        SetBrush("AccentLightBrush", IsDark ? "#FF234A3F" : "#FFD3F0E3");
        SetBrush("ListItemSelectedBackgroundBrush", IsDark ? "#FF234A3F" : "#FFD3F0E3");
        SetBrush("ListItemSelectedBorderBrush", IsDark ? "#FF2A6552" : "#FFA8E4CD");
        SetBrush("ToolbarHoverBackgroundBrush", IsDark ? "#FF3A424E" : "#FFE8ECF1");
        SetBrush("ToolbarActiveBackgroundBrush", IsDark ? "#FF234A3F" : "#FFD3F0E3");
        SetBrush("ToolbarActiveForegroundBrush", IsDark ? "#FF34D399" : "#FF007F55");
        SetBrush("ToolbarActiveBorderBrush", IsDark ? "#FF2A6552" : "#FF8FD9BC");
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

using Microsoft.Win32;

namespace LightNote.App;

public static class StartupRegistrationService
{
    private const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "LightNote";

    public static bool IsEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, writable: false);
            return key?.GetValue(ValueName) is not null;
        }
        catch
        {
            return false;
        }
    }

    public static void SetEnabled(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, writable: true);
            if (key is null) return;
            if (enabled)
            {
                var exePath = Environment.ProcessPath;
                if (!string.IsNullOrEmpty(exePath))
                {
                    key.SetValue(ValueName, $"\"{exePath}\"");
                }
            }
            else
            {
                key.DeleteValue(ValueName, throwOnMissingValue: false);
            }
        }
        catch
        {
        }
    }

    public static bool RemoveLegacyRegistration()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, writable: true);
        if (key?.GetValue(ValueName) is null)
        {
            return false;
        }

        key.DeleteValue(ValueName, throwOnMissingValue: false);
        return true;
    }
}

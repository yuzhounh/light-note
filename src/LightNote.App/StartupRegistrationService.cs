using Microsoft.Win32;

namespace LightNote.App;

public static class StartupRegistrationService
{
    private const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "LightNote";

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

using System.Windows;
using System.Windows.Controls;
using LightNote.Infrastructure.Settings;

namespace LightNote.App;

public partial class SettingsDialog : Window
{
    private readonly AppSettings _originalSettings;

    public SettingsDialog(AppSettings settings)
    {
        InitializeComponent();
        _originalSettings = settings;

        ThemeBox.SelectedValue = settings.Theme;
        MinimizeToTrayBox.IsChecked = settings.MinimizeToTray;
        StartWithWindowsBox.IsChecked = settings.StartWithWindows;
        AutomaticBackupsBox.IsChecked = settings.AutomaticBackups;
        RetentionBox.Text = settings.BackupRetentionCount.ToString();
    }

    public AppSettings Settings { get; private set; } = new();

    private void OnSaveClick(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(RetentionBox.Text, out var retentionCount) || retentionCount is < 1 or > 100)
        {
            MessageBox.Show(this, "自动备份保留份数请输入 1 到 100 之间的整数。", "LightNote 设置",
                MessageBoxButton.OK, MessageBoxImage.Information);
            RetentionBox.Focus();
            RetentionBox.SelectAll();
            return;
        }

        var theme = (ThemeBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "system";
        Settings = _originalSettings with
        {
            Theme = theme,
            MinimizeToTray = MinimizeToTrayBox.IsChecked == true,
            StartWithWindows = StartWithWindowsBox.IsChecked == true,
            AutomaticBackups = AutomaticBackupsBox.IsChecked == true,
            BackupRetentionCount = retentionCount
        };

        DialogResult = true;
    }
}

using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using Forms = System.Windows.Forms;
using LightNote.Core.Abstractions;

namespace LightNote.App;

public sealed class TrayIconService : IDisposable
{
    private Forms.NotifyIcon? _trayIcon;
    private Icon? _trayIconImage;
    private ContextMenu? _trayContextMenu;
    private MenuItem? _autoStartMenuItem;
    private MainWindow? _mainWindow;
    private IAppLogger? _logger;
    private bool _disposed;

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr windowHandle);

    public void Initialize(MainWindow mainWindow, IAppLogger logger)
    {
        _mainWindow = mainWindow;
        _logger = logger;

        CreateContextMenu();
        CreateNotifyIcon();
    }

    private void CreateContextMenu()
    {
        _trayContextMenu = new ContextMenu
        {
            Placement = System.Windows.Controls.Primitives.PlacementMode.MousePoint,
            StaysOpen = false,
            HasDropShadow = false,
        };

        _trayContextMenu.Resources = new ResourceDictionary
        {
            Source = new Uri("/LightNote;component/Styles/TrayMenu.xaml", UriKind.Relative)
        };
        _trayContextMenu.Style = (Style)_trayContextMenu.Resources[typeof(ContextMenu)];

        var openItem = new MenuItem
        {
            Header = "打开 LightNote",
            FontWeight = FontWeights.Normal,
        };
        openItem.Click += (_, _) => ShowMainWindow();
        _trayContextMenu.Items.Add(openItem);

        _trayContextMenu.Items.Add(new Separator());

        _autoStartMenuItem = new MenuItem
        {
            Header = "开机自启动",
            IsCheckable = true,
        };
        _autoStartMenuItem.Click += (_, _) =>
        {
            var isEnabled = StartupRegistrationService.IsEnabled();
            try
            {
                StartupRegistrationService.SetEnabled(!isEnabled);
                _autoStartMenuItem.IsChecked = !isEnabled;
            }
            catch (Exception ex)
            {
                _autoStartMenuItem.IsChecked = isEnabled;
                _logger?.Error("Failed to update autostart setting.", ex);
                System.Windows.MessageBox.Show(
                    $"设置开机自启动失败：{ex.Message}",
                    "开机自启动",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning);
            }
        };
        _trayContextMenu.Items.Add(_autoStartMenuItem);

        _trayContextMenu.Items.Add(new Separator());

        var exitItem = new MenuItem
        {
            Header = "退出",
        };
        exitItem.Click += (_, _) => ExitApplication();
        _trayContextMenu.Items.Add(exitItem);

        _trayContextMenu.Opened += (_, _) =>
        {
            if (_autoStartMenuItem is not null)
            {
                _autoStartMenuItem.IsChecked = StartupRegistrationService.IsEnabled();
            }

            System.Windows.Application.Current.Dispatcher.BeginInvoke(DispatcherPriority.Input, () =>
            {
                if (PresentationSource.FromVisual(_trayContextMenu) is HwndSource source)
                {
                    SetForegroundWindow(source.Handle);
                    _trayContextMenu.Focus();
                }
            });
        };
    }

    private void CreateNotifyIcon()
    {
        try
        {
            var appDir = AppDomain.CurrentDomain.BaseDirectory;
            var iconPath = Path.Combine(appDir, "Assets", "pen-note-icon-yellow.ico");
            if (File.Exists(iconPath))
            {
                _trayIconImage = new Icon(iconPath);
            }
        }
        catch
        {
        }

        if (_trayIconImage is null && !string.IsNullOrWhiteSpace(Environment.ProcessPath))
        {
            try
            {
                _trayIconImage = Icon.ExtractAssociatedIcon(Environment.ProcessPath);
            }
            catch
            {
            }
        }
        _trayIconImage ??= (Icon)SystemIcons.Application.Clone();

        _trayIcon = new Forms.NotifyIcon
        {
            Text = "LightNote - 轻量笔记",
            Icon = _trayIconImage,
            Visible = true,
        };

        _trayIcon.MouseUp += (_, e) =>
        {
            if (e.Button == Forms.MouseButtons.Left)
            {
                System.Windows.Application.Current.Dispatcher.Invoke(() =>
                {
                    if (_trayContextMenu is not null)
                    {
                        _trayContextMenu.IsOpen = false;
                    }
                    ShowMainWindow();
                });
            }
            else if (e.Button == Forms.MouseButtons.Right)
            {
                System.Windows.Application.Current.Dispatcher.Invoke(() =>
                {
                    if (_trayContextMenu is null) return;
                    if (_autoStartMenuItem is not null)
                    {
                        _autoStartMenuItem.IsChecked = StartupRegistrationService.IsEnabled();
                    }
                    _trayContextMenu.IsOpen = true;
                });
            }
        };

        _trayIcon.DoubleClick += (_, _) =>
        {
            System.Windows.Application.Current.Dispatcher.Invoke(ShowMainWindow);
        };
    }

    private void ShowMainWindow()
    {
        _mainWindow?.ShowAndActivate();
    }

    private void ExitApplication()
    {
        _mainWindow?.ExitApplication();
    }

    public void ShowBalloon(string title, string text, Forms.ToolTipIcon icon = Forms.ToolTipIcon.Info)
    {
        try
        {
            _trayIcon?.ShowBalloonTip(2000, title, text, icon);
        }
        catch
        {
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_trayIcon is not null)
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _trayIcon = null;
        }
        _trayIconImage?.Dispose();
        _trayIconImage = null;
    }
}

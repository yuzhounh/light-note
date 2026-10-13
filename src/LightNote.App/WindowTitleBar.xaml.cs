using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.UI.Windowing;

namespace LightNote.App;

public partial class WindowTitleBar : UserControl
{
    private Window? _window;
    private AppWindow? _appWindow;
    private bool _forwardingClose;

    public static readonly DependencyProperty ShowMinMaxProperty = DependencyProperty.Register(
        nameof(ShowMinMax), typeof(bool), typeof(WindowTitleBar),
        new PropertyMetadata(true, (d, _) => ((WindowTitleBar)d).UpdatePresenter()));

    public bool ShowMinMax
    {
        get => (bool)GetValue(ShowMinMaxProperty);
        set => SetValue(ShowMinMaxProperty, value);
    }

    public bool UsesTallNativeTitleBar { get; private set; }
    public string? InitializationError { get; private set; }

    public WindowTitleBar()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        SizeChanged += (_, _) => UpdateMetrics();
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (Window.GetWindow(this) is { } window) InitializeForWindow(window);
    }

    internal void InitializeForWindow(Window window)
    {
        if (_window is not null) return;
        _window = window;
        try
        {
            if (!AppWindowTitleBar.IsCustomizationSupported())
            {
                InitializationError = "Windows does not support title bar customization.";
                Height = 0;
                return;
            }
            var handle = new WindowInteropHelper(window).EnsureHandle();
            _appWindow = AppWindow.GetFromWindowId(Microsoft.UI.Win32Interop.GetWindowIdFromWindow(handle));
            _appWindow.TitleBar.ExtendsContentIntoTitleBar = true;
            _appWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
            UpdatePresenter();
            UsesTallNativeTitleBar = true;
            _appWindow.Changed += OnAppWindowChanged;
            _appWindow.Closing += OnAppWindowClosing;
            window.DpiChanged += OnDpiChanged;
            window.Activated += OnActivationChanged;
            window.Deactivated += OnActivationChanged;
            window.Closed += OnWindowClosed;
            ThemeService.ThemeChanged += OnThemeChanged;
            UpdateMetrics();
            UpdateColors();
        }
        catch (Exception exception)
        {
            // Keep an operable system title bar if a machine cannot load the SDK runtime.
            Trace.TraceError($"Tall native title bar initialization failed: {exception}");
            InitializationError = exception.ToString();
            _appWindow?.TitleBar.ResetToDefault();
            UsesTallNativeTitleBar = false;
            Height = 0;
        }
    }

    private void UpdatePresenter()
    {
        if (_window is null || _appWindow?.Presenter is not OverlappedPresenter presenter) return;
        presenter.IsMinimizable = ShowMinMax && _window.ResizeMode != ResizeMode.NoResize;
        presenter.IsMaximizable = ShowMinMax && _window.ResizeMode is ResizeMode.CanResize or ResizeMode.CanResizeWithGrip;
    }

    private void UpdateMetrics()
    {
        if (!UsesTallNativeTitleBar || _window is null || _appWindow is null) return;
        var scale = VisualTreeHelper.GetDpi(_window);
        // SDK metrics are physical pixels; WPF sizes are logical pixels.
        var height = _appWindow.TitleBar.Height / scale.DpiScaleY;
        if (height > 0 && Math.Abs(Height - height) > 0.01) Height = height;
        // Maximized native frames can briefly report negative edge offsets; WPF column widths cannot be negative.
        LeftCaptionInset.Width = new GridLength(Math.Max(0, _appWindow.TitleBar.LeftInset / scale.DpiScaleX));
        RightCaptionInset.Width = new GridLength(Math.Max(0, _appWindow.TitleBar.RightInset / scale.DpiScaleX));
        // With no custom drag rectangles, Windows owns the full Tall caption region,
        // including dragging, double-click maximize, the system menu and Snap Layouts.
    }

    private void UpdateColors()
    {
        if (!UsesTallNativeTitleBar || _appWindow is null || _window is null) return;
        var foreground = (TryFindResource("TextBrush") as SolidColorBrush)?.Color ?? Colors.Black;
        var muted = (TryFindResource("MutedTextBrush") as SolidColorBrush)?.Color ?? Colors.Gray;
        var background = (TryFindResource("SecondaryPanelBrush") as SolidColorBrush)?.Color ?? Colors.White;
        var dark = background.R * 0.299 + background.G * 0.587 + background.B * 0.114 < 128;
        var bar = _appWindow.TitleBar;
        var transparent = new Windows.UI.Color { A = 0 };
        bar.ButtonBackgroundColor = transparent;
        bar.ButtonInactiveBackgroundColor = transparent;
        bar.ButtonForegroundColor = ToNativeColor(foreground);
        bar.ButtonInactiveForegroundColor = ToNativeColor(muted);
        bar.ButtonHoverForegroundColor = ToNativeColor(foreground);
        bar.ButtonPressedForegroundColor = ToNativeColor(foreground);
        bar.ButtonHoverBackgroundColor = ToNativeColor(dark ? Color.FromRgb(54, 59, 67) : Color.FromRgb(223, 227, 232));
        bar.ButtonPressedBackgroundColor = ToNativeColor(dark ? Color.FromRgb(69, 75, 84) : Color.FromRgb(200, 205, 211));
        // Windows retains its own red hover/pressed colors for the Close button.
        CaptionText.SetResourceReference(TextBlock.ForegroundProperty, _window.IsActive ? "TextBrush" : "MutedTextBrush");
        WindowNativeHelper.ApplyImmersiveDarkMode(_window, dark);
    }

    private static Windows.UI.Color ToNativeColor(Color color) => new()
    {
        A = color.A, R = color.R, G = color.G, B = color.B,
    };

    private void OnAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        // SDK callbacks can arrive outside WPF's UI thread or during native resize processing.
        if (args.DidSizeChange && !Dispatcher.HasShutdownStarted)
            Dispatcher.BeginInvoke(UpdateMetrics);
    }

    private void OnDpiChanged(object sender, DpiChangedEventArgs args) => UpdateMetrics();

    private void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (_forwardingClose || _window is null) return;
        // WPF owns the window lifetime, modal result and unsaved-note close handling.
        args.Cancel = true;
        _forwardingClose = true;
        Dispatcher.BeginInvoke(() =>
        {
            try { _window?.Close(); }
            finally { _forwardingClose = false; }
        });
    }
    private void OnActivationChanged(object? sender, EventArgs args) => UpdateColors();
    private void OnThemeChanged(object? sender, EventArgs args) => UpdateColors();

    private void OnWindowClosed(object? sender, EventArgs args)
    {
        if (_appWindow is not null)
        {
            _appWindow.Changed -= OnAppWindowChanged;
            _appWindow.Closing -= OnAppWindowClosing;
        }
        if (_window is not null)
        {
            _window.DpiChanged -= OnDpiChanged;
            _window.Activated -= OnActivationChanged;
            _window.Deactivated -= OnActivationChanged;
            _window.Closed -= OnWindowClosed;
        }
        ThemeService.ThemeChanged -= OnThemeChanged;
        _appWindow = null;
        _window = null;
    }
}

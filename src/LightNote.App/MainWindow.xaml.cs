using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Navigation;
using System.Windows.Shapes;
using System.Text.Json;
using System.ComponentModel;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;
using Microsoft.Web.WebView2.Core;
using Button = System.Windows.Controls.Button;

namespace LightNote.App;

/// <summary>
/// Interaction logic for MainWindow.xaml
/// </summary>
public partial class MainWindow : Window
{
    private const string EditorHostName = "lightnote.editor";
    private const string AttachmentHostName = "lightnote.attachments";
    private readonly MainViewModel _viewModel;
    private readonly AppDataPaths _paths;
    private readonly IAppLogger _logger;
    private readonly IAttachmentService _attachmentService;
    private readonly IBackupService _backupService;
    private readonly SqliteConnectionFactory _connectionFactory;
    private readonly IDatabaseIntegrityChecker _integrityChecker;
    private readonly INoteExportService _exportService;
    private readonly INoteImportService _importService;
    private readonly IFirebaseSyncService _syncService;
    private readonly AppSettingsService _settingsService;
    private readonly ThemeService _themeService;
    private readonly SemaphoreSlim _editorTransitionGate = new(1, 1);
    private readonly System.Windows.Threading.DispatcherTimer _syncTimer = new()
    {
        Interval = TimeSpan.FromMinutes(1),
    };
    private readonly System.Windows.Threading.DispatcherTimer _layoutSaveTimer = new()
    {
        Interval = TimeSpan.FromMilliseconds(450),
    };
    private bool _editorReady;
    private bool _allowClose;
    private bool _closingInProgress;
    private bool _notebookDialogOpen;
    private bool _syncInProgress;
    private bool _windowLoaded;
    private AppSettings _settings;

    public MainWindow(
        MainViewModel viewModel,
        AppDataPaths paths,
        IAppLogger logger,
        IAttachmentService attachmentService,
        IBackupService backupService,
        SqliteConnectionFactory connectionFactory,
        IDatabaseIntegrityChecker integrityChecker,
        INoteExportService exportService,
        INoteImportService importService,
        IFirebaseSyncService syncService,
        AppSettingsService settingsService,
        ThemeService themeService)
    {
        InitializeComponent();
        _viewModel = viewModel;
        _paths = paths;
        _logger = logger;
        _attachmentService = attachmentService;
        _backupService = backupService;
        _connectionFactory = connectionFactory;
        _integrityChecker = integrityChecker;
        _exportService = exportService;
        _importService = importService;
        _syncService = syncService;
        _settingsService = settingsService;
        _themeService = themeService;
        _settings = settingsService.Load();
        AccountSettingsVersionText.Text = $"LightNote {typeof(MainWindow).Assembly.GetName().Version?.ToString(3) ?? "unknown"}";
        _viewModel.ConfigureNavigation(
            _settings.ShowRecentNavigation,
            _settings.ShowPinnedNavigation,
            _settings.ShowTrashNavigation);
        ApplyWindowSettings();
        DataContext = viewModel;
        _viewModel.SelectedNoteChanged += OnSelectedNoteChanged;
        _viewModel.NewNotebookRequested += OnNewNotebookRequested;
        Loaded += OnLoaded;
        Closing += OnClosing;
        SizeChanged += OnWindowLayoutChanged;
        LocationChanged += OnWindowLayoutChanged;
        StateChanged += OnWindowLayoutChanged;
        _layoutSaveTimer.Tick += (_, _) =>
        {
            _layoutSaveTimer.Stop();
            if (_windowLoaded && WindowState != WindowState.Minimized)
            {
                SaveWindowSettings();
            }
        };
        _syncTimer.Tick += async (_, _) => await RunSyncAsync(silent: true);
        Closed += (_, _) =>
        {
            _syncTimer.Stop();
            _layoutSaveTimer.Stop();
            EditorWebView.Dispose();
        };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        _windowLoaded = true;

        try
        {
            await _viewModel.InitializeAsync();
            await InitializeEditorAsync();
            await InitializeSyncAsync();
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to initialize the main window.", exception);
            _viewModel.EditorStatus = "初始化失败，请查看日志";
        }
    }

    private async Task InitializeEditorAsync()
    {
        _viewModel.EditorStatus = "正在启动 WebView2…";
        try
        {
            _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var choice = MessageBox.Show(this,
                "LightNote 需要 Microsoft Edge WebView2 Runtime 才能显示编辑器。是否打开微软官方下载页？",
                "缺少 WebView2 Runtime",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning);
            if (choice == MessageBoxResult.Yes)
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "https://developer.microsoft.com/microsoft-edge/webview2/#download-section",
                    UseShellExecute = true,
                });
            }

            throw;
        }

        var environment = await CoreWebView2Environment.CreateAsync(
            userDataFolder: _paths.WebViewDataDirectory);
        EditorWebView.DefaultBackgroundColor = _themeService.IsDark
            ? System.Drawing.Color.FromArgb(32, 35, 40)
            : System.Drawing.Color.White;
        await EditorWebView.EnsureCoreWebView2Async(environment);
        EditorWebView.CoreWebView2.Profile.PreferredColorScheme = _themeService.IsDark
            ? CoreWebView2PreferredColorScheme.Dark
            : CoreWebView2PreferredColorScheme.Light;

        var editorDirectory = System.IO.Path.Combine(AppContext.BaseDirectory, "Editor");
        if (!System.IO.Directory.Exists(editorDirectory))
        {
            throw new System.IO.DirectoryNotFoundException($"Editor resources were not found: {editorDirectory}");
        }

        EditorWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            EditorHostName,
            editorDirectory,
            CoreWebView2HostResourceAccessKind.DenyCors);
        EditorWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            AttachmentHostName,
            _paths.AttachmentsDirectory,
            CoreWebView2HostResourceAccessKind.DenyCors);
        EditorWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        EditorWebView.CoreWebView2.NavigationCompleted += (_, args) =>
        {
            if (args.IsSuccess)
            {
                _logger.Info("Local editor resources loaded in WebView2.");
            }
            else
            {
                _viewModel.EditorStatus = $"编辑器加载失败：{args.WebErrorStatus}";
                _logger.Error(
                    "WebView2 failed to load local editor resources.",
                    new InvalidOperationException(args.WebErrorStatus.ToString()));
            }
        };
        EditorWebView.Source = new Uri($"https://{EditorHostName}/index.html");
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var message = JsonDocument.Parse(e.WebMessageAsJson);
            if (!message.RootElement.TryGetProperty("type", out var typeElement))
            {
                return;
            }

            switch (typeElement.GetString())
            {
                case "editor.ready":
                    _editorReady = true;
                    _viewModel.EditorStatus = "编辑器已就绪";
                    _logger.Info("WebView2 editor bridge is ready.");
                    SendSelectedNote();
                    break;
                case "note.loaded":
                    if (!_viewModel.HasUnsavedChanges)
                    {
                        _viewModel.EditorStatus = "本地数据已就绪";
                    }
                    break;
                case "note.changed":
                    HandleNoteChanged(message.RootElement);
                    break;
                case "editor.state":
                    HandleEditorState(message.RootElement);
                    break;
                case "attachment.create":
                    await HandleAttachmentCreateAsync(message.RootElement);
                    break;
            }
        }
        catch (Exception exception)
        {
            _logger.Error("Invalid message received from the editor.", exception);
            _viewModel.EditorStatus = "编辑器消息解析失败";
        }
    }

    private void SendSelectedNote()
    {
        var note = _viewModel.SelectedNote?.Model;
        if (!_editorReady || EditorWebView.CoreWebView2 is null)
        {
            return;
        }

        if (note is null)
        {
            EditorWebView.CoreWebView2.PostWebMessageAsJson("{\"type\":\"editor.clear\"}");
            return;
        }

        using var bodyJson = JsonDocument.Parse(note.BodyJson);
        var message = JsonSerializer.Serialize(new
        {
            type = "note.load",
            payload = new
            {
                id = note.Id,
                title = note.Title,
                json = bodyJson.RootElement,
                html = note.BodyHtml,
                text = note.BodyText,
            },
        });
        EditorWebView.CoreWebView2.PostWebMessageAsJson(message);
    }

    private void HandleNoteChanged(JsonElement message)
    {
        if (!message.TryGetProperty("payload", out var payload))
        {
            return;
        }

        ApplyEditorPayload(payload);
    }

    private void ApplyEditorPayload(JsonElement payload)
    {
        if (!payload.TryGetProperty("id", out var idElement) ||
            string.IsNullOrWhiteSpace(idElement.GetString()))
        {
            return;
        }

        var bodyJson = payload.TryGetProperty("json", out var jsonElement)
            ? jsonElement.GetRawText()
            : "{\"type\":\"doc\",\"content\":[]}";
        var bodyHtml = payload.TryGetProperty("html", out var htmlElement)
            ? htmlElement.GetString() ?? string.Empty
            : string.Empty;
        var bodyText = payload.TryGetProperty("text", out var textElement)
            ? textElement.GetString() ?? string.Empty
            : string.Empty;
        _viewModel.ApplyEditorChange(idElement.GetString()!, bodyJson, bodyHtml, bodyText);
    }

    private async Task HandleAttachmentCreateAsync(JsonElement message)
    {
        if (!message.TryGetProperty("payload", out var payload))
        {
            return;
        }

        var requestId = payload.TryGetProperty("requestId", out var requestElement)
            ? requestElement.GetString() ?? string.Empty
            : string.Empty;
        var noteId = payload.TryGetProperty("noteId", out var noteElement)
            ? noteElement.GetString() ?? string.Empty
            : string.Empty;
        try
        {
            var fileName = payload.TryGetProperty("fileName", out var nameElement)
                ? nameElement.GetString() ?? "image"
                : "image";
            var mimeType = payload.TryGetProperty("mimeType", out var mimeElement)
                ? mimeElement.GetString() ?? "application/octet-stream"
                : "application/octet-stream";
            var base64 = payload.TryGetProperty("dataBase64", out var dataElement)
                ? dataElement.GetString() ?? string.Empty
                : string.Empty;
            if (string.IsNullOrWhiteSpace(requestId) || string.IsNullOrWhiteSpace(noteId) ||
                base64.Length == 0 || base64.Length > 28_000_000)
            {
                throw new System.IO.InvalidDataException("图片消息缺少必要内容或超过 20 MB 限制。");
            }

            var imported = await _attachmentService.ImportAsync(
                noteId,
                fileName,
                mimeType,
                Convert.FromBase64String(base64));
            var escapedPath = string.Join(
                "/",
                imported.RelativePath.Split('/').Select(Uri.EscapeDataString));
            PostEditorMessage(new
            {
                type = "attachment.created",
                payload = new
                {
                    requestId,
                    noteId,
                    id = imported.Id,
                    url = $"https://{AttachmentHostName}/{escapedPath}",
                    imported.Width,
                    imported.Height,
                },
            });
            _viewModel.EditorStatus = "图片已保存到本地";
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to import an editor image.", exception);
            PostEditorMessage(new
            {
                type = "attachment.error",
                payload = new
                {
                    requestId,
                    message = exception is NotSupportedException or System.IO.InvalidDataException
                        ? exception.Message
                        : "图片保存失败，请查看日志。",
                },
            });
            _viewModel.EditorStatus = "图片保存失败";
        }
    }

    private void HandleEditorState(JsonElement message)
    {
        if (!message.TryGetProperty("payload", out var state))
        {
            return;
        }

        SetFormattingButtonState(BoldButton, ReadBoolean(state, "bold"));
        SetFormattingButtonState(ItalicButton, ReadBoolean(state, "italic"));
        SetFormattingButtonState(UnderlineButton, ReadBoolean(state, "underline"));
        SetFormattingButtonState(StrikeButton, ReadBoolean(state, "strike"));
        SetFormattingButtonState(HighlightButton, ReadBoolean(state, "highlight"));
        SetFormattingButtonState(BulletListButton, ReadBoolean(state, "bulletList"));
        SetFormattingButtonState(OrderedListButton, ReadBoolean(state, "orderedList"));

        var block = state.TryGetProperty("block", out var blockElement)
            ? blockElement.GetString()
            : "p";
        SetFormattingButtonState(ParagraphButton, block == "p");
        SetFormattingButtonState(Heading1Button, block == "h1");
        SetFormattingButtonState(Heading2Button, block == "h2");
        SetFormattingButtonState(QuoteButton, block == "blockquote");
        SetFormattingButtonState(CodeBlockButton, block == "pre");
    }

    private void OnEditorCommandClick(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string command } || !_editorReady)
        {
            return;
        }

        PostEditorMessage(new { type = "editor.command", payload = new { command } });
    }

    private void OnEditorFontFamilyChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_editorReady || FontFamilyBox.SelectedItem is not ComboBoxItem { Tag: string fontFamily })
        {
            return;
        }

        PostEditorMessage(new
        {
            type = "editor.command",
            payload = new { command = "fontFamily", value = fontFamily },
        });
    }

    private void OnEditorFontSizeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_editorReady || FontSizeBox.SelectedItem is not ComboBoxItem { Tag: string fontSize })
        {
            return;
        }

        PostEditorMessage(new
        {
            type = "editor.command",
            payload = new { command = "fontSize", value = fontSize },
        });
    }

    private void PostEditorMessage(object message)
    {
        EditorWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    private void SetFormattingButtonState(Button button, bool isActive)
    {
        button.Background = isActive
            ? (Brush)FindResource("AccentLightBrush")
            : Brushes.Transparent;
        button.Foreground = isActive
            ? (Brush)FindResource("AccentBrush")
            : (Brush)FindResource("TextBrush");
    }

    private static bool ReadBoolean(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var property) &&
        property.ValueKind is JsonValueKind.True;

    private async void OnSelectedNoteChanged(object? sender, EventArgs e)
    {
        var requestedNoteId = _viewModel.SelectedNote?.Model.Id;
        await _editorTransitionGate.WaitAsync();
        try
        {
            await CaptureEditorSnapshotAsync();
            if (_viewModel.SelectedNote?.Model.Id == requestedNoteId)
            {
                SendSelectedNote();
            }
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to switch the editor note.", exception);
            _viewModel.EditorStatus = "切换笔记失败，请查看日志";
        }
        finally
        {
            _editorTransitionGate.Release();
        }
    }

    private async Task CaptureEditorSnapshotAsync()
    {
        if (!_editorReady || EditorWebView.CoreWebView2 is null)
        {
            return;
        }

        var result = await EditorWebView.CoreWebView2.ExecuteScriptAsync(
            "window.lightNoteEditor ? window.lightNoteEditor.getSnapshot() : null");
        if (string.IsNullOrWhiteSpace(result) || result == "null")
        {
            return;
        }

        using var snapshot = JsonDocument.Parse(result);
        if (snapshot.RootElement.ValueKind == JsonValueKind.Object)
        {
            ApplyEditorPayload(snapshot.RootElement);
        }
    }

    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_allowClose)
        {
            return;
        }

        e.Cancel = true;
        if (_closingInProgress)
        {
            return;
        }

        _closingInProgress = true;
        try
        {
            await CaptureEditorSnapshotAsync();
            var saved = await _viewModel.FlushAllAsync();
            if (!saved)
            {
                var choice = MessageBox.Show(
                    "仍有内容未能保存。是否放弃未保存内容并退出？",
                    "LightNote",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Warning,
                    MessageBoxResult.No);
                if (choice != MessageBoxResult.Yes)
                {
                    return;
                }
            }

            SaveWindowSettings();
            _allowClose = true;
            Close();
        }
        catch (Exception exception)
        {
            _logger.Error("Failed while saving before exit.", exception);
            MessageBox.Show(
                "退出前保存失败，LightNote 将保持打开。详情已写入日志。",
                "LightNote",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            _closingInProgress = false;
        }
    }

    private async void OnNewNotebookClick(object sender, RoutedEventArgs e) =>
        await ShowNewNotebookDialogAsync();

    private async void OnNewNotebookGroupClick(object sender, RoutedEventArgs e) =>
        await ShowNewNotebookGroupDialogAsync();

    private void OnAccountButtonClick(object sender, RoutedEventArgs e)
    {
        ConfigureAccountPopup();
        var leftInset = SidebarFooter.TranslatePoint(new Point(0, 0), SidebarPanel).X;
        AccountPopupCard.Width = Math.Max(0, SidebarPanel.ActualWidth - (leftInset * 2));
        AccountPopup.IsOpen = true;
    }

    private void ConfigureAccountPopup()
    {
        var account = _syncService.CurrentAccount;
        var isSignedIn = account is not null;
        AccountPopupIdentityText.Text = isSignedIn ? account!.Email : "Google 账户";
        AccountPopupStatusText.Text = isSignedIn ? _viewModel.SyncStatus : "登录后可在设备之间同步笔记";
        AccountPrimaryText.Text = isSignedIn ? "立即同步" : "Google 登录";
        AccountPopupSignOutButton.Visibility = isSignedIn ? Visibility.Visible : Visibility.Collapsed;
        AccountSignOutSeparator.Visibility = isSignedIn ? Visibility.Visible : Visibility.Collapsed;
        UpdateThemeMenu();
    }

    private void OnAccountPopupPrimaryClick(object sender, RoutedEventArgs e)
    {
        AccountPopup.IsOpen = false;
        OnSyncClick(sender, e);
    }

    private void OnAccountPopupSignOutClick(object sender, RoutedEventArgs e)
    {
        AccountPopup.IsOpen = false;
        OnSignOutClick(sender, e);
    }

    private void OnAccountPopupSettingsClick(object sender, RoutedEventArgs e)
    {
        AccountPopup.IsOpen = false;
        OpenSettings(SettingsSection.General);
    }

    private void OnThemeModeClick(object sender, RoutedEventArgs e)
    {
        UpdateThemeMenu();
        AccountThemeMenu.PlacementTarget = ThemeModeButton;
        AccountThemeMenu.Placement = System.Windows.Controls.Primitives.PlacementMode.Right;
        AccountThemeMenu.IsOpen = true;
    }

    private void UpdateThemeMenu()
    {
        AccountThemeCurrentText.Text = _settings.Theme switch
        {
            "light" => "浅色",
            "dark" => "深色",
            _ => "系统",
        };
        ThemeSystemMenuItem.IsChecked = _settings.Theme == "system";
        ThemeLightMenuItem.IsChecked = _settings.Theme == "light";
        ThemeDarkMenuItem.IsChecked = _settings.Theme == "dark";
    }

    private void OnAccountThemeOptionClick(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string theme } || theme == _settings.Theme)
        {
            return;
        }

        try
        {
            _settings = _settings with { Theme = theme };
            _settingsService.Save(_settings);
            ApplyTheme();
            UpdateThemeMenu();
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to save the color mode.", exception);
            MessageBox.Show(this, $"颜色模式未能保存：{exception.Message}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnSidebarContextMenuOpened(object sender, RoutedEventArgs e)
    {
        if (sender is ContextMenu menu)
        {
            UpdateSidebarContextMenuChecks(menu);
        }
    }

    private void UpdateSidebarContextMenuChecks(ContextMenu menu)
    {
        foreach (var item in menu.Items.OfType<MenuItem>())
        {
            item.IsChecked = item.Tag?.ToString() switch
            {
                "navigation:recent" => _settings.ShowRecentNavigation,
                "navigation:pinned" => _settings.ShowPinnedNavigation,
                "navigation:trash" => _settings.ShowTrashNavigation,
                _ => false,
            };
        }
    }

    private async void OnNavigationMenuItemClick(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string tag } item)
        {
            return;
        }

        _settings = tag switch
        {
            "navigation:recent" => _settings with { ShowRecentNavigation = item.IsChecked },
            "navigation:pinned" => _settings with { ShowPinnedNavigation = item.IsChecked },
            "navigation:trash" => _settings with { ShowTrashNavigation = item.IsChecked },
            _ => _settings,
        };

        try
        {
            _settingsService.Save(_settings);
            await _viewModel.UpdateNavigationAsync(
                _settings.ShowRecentNavigation,
                _settings.ShowPinnedNavigation,
                _settings.ShowTrashNavigation);
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to update sidebar navigation.", exception);
            MessageBox.Show(this, "无法更新导航显示设置，请查看日志。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnPaneSplitterDragCompleted(object sender, System.Windows.Controls.Primitives.DragCompletedEventArgs e) =>
        QueueLayoutSave();

    private void OnWindowLayoutChanged(object? sender, EventArgs e) => QueueLayoutSave();

    private void QueueLayoutSave()
    {
        if (!_windowLoaded)
        {
            return;
        }

        _layoutSaveTimer.Stop();
        _layoutSaveTimer.Start();
    }

    private void OnNotePreviewMouseRightButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (sender is ListBoxItem item)
        {
            item.IsSelected = true;
            item.Focus();
            item.ContextMenu ??= CreateNoteContextMenu();
        }
    }

    private void OnNotebookPreviewMouseRightButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (sender is not ListBoxItem { DataContext: NotebookListItem item } container)
        {
            return;
        }

        container.IsSelected = true;
        container.Focus();
        container.ContextMenu = CreateNotebookContextMenu(item);
    }

    private ContextMenu CreateNotebookContextMenu(NotebookListItem item)
    {
        var menu = new ContextMenu();
        if (item.Kind == NotebookKind.GroupRoot)
        {
            menu.Items.Add(CreateNotebookMenuItem("新建笔记本组", null, OnNewNotebookGroupClick));
        }
        else if (item.Kind == NotebookKind.Group)
        {
            menu.Items.Add(CreateNotebookMenuItem("重命名笔记本组…", item.Id, OnRenameNotebookGroupClick));
            menu.Items.Add(CreateNotebookMenuItem("删除笔记本组", item.Id, OnDeleteNotebookGroupClick));
        }
        else if (item.Kind == NotebookKind.User && item.Id is not null)
        {
            menu.Items.Add(CreateNotebookMenuItem("移出笔记本组", new NotebookGroupAssignment(item.Id, null),
                OnAssignNotebookGroupClick));
            foreach (var group in _viewModel.Notebooks.Where(candidate => candidate.Kind == NotebookKind.Group))
            {
                menu.Items.Add(CreateNotebookMenuItem(
                    $"移到“{group.Name}”",
                    new NotebookGroupAssignment(item.Id, group.Id),
                    OnAssignNotebookGroupClick));
            }
        }

        return menu;
    }

    private static MenuItem CreateNotebookMenuItem(
        string header,
        object? tag,
        RoutedEventHandler clickHandler)
    {
        var item = new MenuItem { Header = header, Tag = tag };
        item.Click += clickHandler;
        return item;
    }

    private ContextMenu CreateNoteContextMenu()
    {
        var menu = new ContextMenu();
        menu.Opened += OnNoteContextMenuOpened;
        menu.Items.Add(CreateNoteMenuItem("置顶 / 取消置顶", "normal", OnTogglePinMenuClick));
        menu.Items.Add(CreateNoteMenuItem("移动到笔记本…", "normal", OnMoveNoteClick));
        menu.Items.Add(CreateNoteMenuItem("编辑标签…", "normal", OnEditTagsClick));
        menu.Items.Add(CreateNoteMenuItem("历史版本…", null, OnHistoryClick));
        menu.Items.Add(CreateNoteMenuItem("导出…", null, OnExportNoteClick));
        menu.Items.Add(new Separator
        {
            Tag = "normal",
            Style = (Style)FindResource("MenuSeparatorStyle"),
        });
        menu.Items.Add(CreateNoteMenuItem("移到回收站", "normal", OnDeleteNoteMenuClick));
        menu.Items.Add(CreateNoteMenuItem("恢复笔记", "trash", OnRestoreNoteMenuClick));
        menu.Items.Add(CreateNoteMenuItem("永久删除", "trash", OnPermanentDeleteClick));
        return menu;
    }

    private static MenuItem CreateNoteMenuItem(
        string header,
        string? tag,
        RoutedEventHandler clickHandler)
    {
        var item = new MenuItem { Header = header, Tag = tag };
        item.Click += clickHandler;
        return item;
    }

    private void OnNoteContextMenuOpened(object sender, RoutedEventArgs e)
    {
        if (sender is not ContextMenu menu)
        {
            return;
        }

        foreach (var element in menu.Items.OfType<FrameworkElement>())
        {
            element.Visibility = element.Tag?.ToString() switch
            {
                "normal" => _viewModel.IsTrashSelected ? Visibility.Collapsed : Visibility.Visible,
                "trash" => _viewModel.IsTrashSelected ? Visibility.Visible : Visibility.Collapsed,
                _ => Visibility.Visible,
            };
        }
    }

    private void OnTogglePinMenuClick(object sender, RoutedEventArgs e) =>
        _viewModel.TogglePinCommand.Execute(null);

    private void OnDeleteNoteMenuClick(object sender, RoutedEventArgs e) =>
        _viewModel.DeleteNoteCommand.Execute(null);

    private void OnRestoreNoteMenuClick(object sender, RoutedEventArgs e) =>
        _viewModel.RestoreNoteCommand.Execute(null);

    private async void OnNewNotebookRequested(object? sender, EventArgs e) =>
        await ShowNewNotebookDialogAsync();

    private async Task ShowNewNotebookDialogAsync()
    {
        if (_notebookDialogOpen)
        {
            return;
        }

        _notebookDialogOpen = true;
        try
        {
            var dialog = new TextPromptDialog("新建笔记本", "输入笔记本名称：") { Owner = this };
            if (dialog.ShowDialog() == true)
            {
                await _viewModel.CreateNotebookAsync(dialog.Value);
            }
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to create a notebook.", exception);
            MessageBox.Show("无法创建笔记本，请查看日志。", "LightNote", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _notebookDialogOpen = false;
        }
    }

    private async Task ShowNewNotebookGroupDialogAsync()
    {
        var dialog = new TextPromptDialog("新建笔记本组", "输入笔记本组名称：") { Owner = this };
        if (dialog.ShowDialog() != true)
        {
            return;
        }

        try
        {
            await _viewModel.CreateNotebookGroupAsync(dialog.Value);
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to create a notebook group.", exception);
            MessageBox.Show(this, "无法创建笔记本组；名称可能已经存在。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnRenameNotebookGroupClick(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string groupId })
        {
            return;
        }

        var group = _viewModel.Notebooks.FirstOrDefault(item => item.Kind == NotebookKind.Group && item.Id == groupId);
        if (group is null)
        {
            return;
        }

        var dialog = new TextPromptDialog("重命名笔记本组", "输入新的组名称：", group.Name) { Owner = this };
        if (dialog.ShowDialog() == true)
        {
            try
            {
                await _viewModel.RenameNotebookGroupAsync(groupId, dialog.Value);
            }
            catch (Exception exception)
            {
                _logger.Error("Failed to rename a notebook group.", exception);
                MessageBox.Show(this, "无法重命名笔记本组；名称可能已经存在。", "LightNote",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }

    private async void OnDeleteNotebookGroupClick(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string groupId })
        {
            return;
        }

        var group = _viewModel.Notebooks.FirstOrDefault(item => item.Kind == NotebookKind.Group && item.Id == groupId);
        if (group is null || MessageBox.Show(this,
                $"删除笔记本组“{group.Name}”？组内笔记本和笔记都会保留。",
                "LightNote", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes)
        {
            return;
        }

        await _viewModel.DeleteNotebookGroupAsync(groupId);
    }

    private async void OnAssignNotebookGroupClick(object sender, RoutedEventArgs e)
    {
        if (sender is MenuItem { Tag: NotebookGroupAssignment assignment })
        {
            await _viewModel.AssignNotebookToGroupAsync(assignment.NotebookId, assignment.GroupId);
        }
    }

    private async void OnNoteMouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (sender is not ListBoxItem { DataContext: NoteListItem item } || item.Model.DeletedAt is not null)
        {
            return;
        }

        try
        {
            await CaptureEditorSnapshotAsync();
            await _viewModel.FlushAllAsync();
            var window = new NoteWindow(
                item.Model,
                _viewModel,
                _paths,
                _logger,
                _attachmentService,
                _themeService)
            {
                Owner = this,
            };
            window.Show();
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to open a note window.", exception);
            MessageBox.Show(this, "无法在独立窗口打开笔记，请查看日志。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnPermanentDeleteClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.SelectedNote is null)
        {
            return;
        }

        var choice = MessageBox.Show(
            $"永久删除“{_viewModel.SelectedNote.Title}”？此操作无法撤销。",
            "LightNote",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning,
            MessageBoxResult.No);
        if (choice == MessageBoxResult.Yes)
        {
            await _viewModel.DeletePermanentlyAsync();
        }
    }

    private async void OnEditTagsClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.SelectedNote is null)
        {
            return;
        }

        try
        {
            var existingTags = await _viewModel.GetSelectedTagNamesAsync();
            var dialog = new TextPromptDialog(
                "编辑标签",
                "用中文或英文逗号分隔标签名称；清空输入可移除全部标签：",
                string.Join(", ", existingTags),
                allowEmpty: true)
            {
                Owner = this,
            };
            if (dialog.ShowDialog() == true)
            {
                await _viewModel.SetSelectedTagsAsync(dialog.Value);
            }
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to edit note tags.", exception);
            MessageBox.Show("无法保存标签，请查看日志。", "LightNote", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnMoveNoteClick(object sender, RoutedEventArgs e)
    {
        var note = _viewModel.SelectedNote?.Model;
        if (note is null)
        {
            return;
        }

        try
        {
            var destinations = new[] { new MoveDestination(null, "未归档") }
                .Concat(_viewModel.Notebooks
                    .Where(item => item.Kind == NotebookKind.User)
                    .Select(item => new MoveDestination(item.Id, item.Name)))
                .ToArray();
            var dialog = new MoveNoteDialog(destinations, note.NotebookId) { Owner = this };
            if (dialog.ShowDialog() == true)
            {
                await _viewModel.MoveSelectedNoteAsync(dialog.SelectedNotebookId);
            }
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to move a note.", exception);
            MessageBox.Show("无法移动笔记，请查看日志。", "LightNote", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnHistoryClick(object sender, RoutedEventArgs e)
    {
        if (_viewModel.SelectedNote is null || _viewModel.IsTrashSelected)
        {
            return;
        }

        try
        {
            await CaptureEditorSnapshotAsync();
            if (!await _viewModel.FlushAllAsync())
            {
                throw new InvalidOperationException("当前更改尚未保存。");
            }

            var versions = await _viewModel.GetSelectedHistoryAsync();
            if (versions.Count == 0)
            {
                MessageBox.Show(this, "这篇笔记还没有历史版本。", "LightNote",
                    MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }

            var dialog = new HistoryDialog(versions, _viewModel.SelectedNote.Model) { Owner = this };
            if (dialog.ShowDialog() == true && dialog.SelectedVersionId is not null)
            {
                await _viewModel.RestoreVersionAsync(dialog.SelectedVersionId);
            }
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to restore note history.", exception);
            MessageBox.Show(this, "无法读取或恢复历史版本，请查看日志。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnBackupClick(object sender, RoutedEventArgs e)
    {
        try
        {
            await CaptureEditorSnapshotAsync();
            if (!await _viewModel.FlushAllAsync())
            {
                throw new InvalidOperationException("仍有笔记未能保存。");
            }

            var backupPath = await _backupService.CreateAsync();
            MessageBox.Show(this, $"备份已创建：\n{backupPath}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to create a backup.", exception);
            MessageBox.Show(this, "备份失败，请查看日志。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnImportClick(object sender, RoutedEventArgs e)
    {
        var sourceDialog = new ImportSourceDialog { Owner = this };
        if (sourceDialog.ShowDialog() != true)
        {
            return;
        }

        IReadOnlyList<string> sourcePaths;
        string? sourceRoot = null;
        string? importNotebookName = null;
        var prefixRelativeDirectory = false;
        try
        {
            if (sourceDialog.SelectedSourceKind == ImportSourceKind.Folder)
            {
                var folderDialog = new Microsoft.Win32.OpenFolderDialog
                {
                    Title = "选择包含笔记文件的文件夹",
                    Multiselect = false,
                };
                if (folderDialog.ShowDialog(this) != true)
                {
                    return;
                }

                sourceRoot = folderDialog.FolderName;
                sourcePaths = System.IO.Directory.EnumerateFiles(sourceRoot, "*", System.IO.SearchOption.AllDirectories)
                    .Where(IsSupportedImportPath)
                    .ToArray();
                sourcePaths = RemovePairedHtmlFiles(sourcePaths);
                prefixRelativeDirectory = true;
                if (sourcePaths.Count == 0)
                {
                    MessageBox.Show(this, "该文件夹中没有可导入的 ENEX、Google Keep JSON、CSV、Markdown、文本或 HTML 文件。", "LightNote",
                        MessageBoxButton.OK, MessageBoxImage.Information);
                    return;
                }

                importNotebookName = System.IO.Path.GetFileName(sourceRoot.TrimEnd(
                    System.IO.Path.DirectorySeparatorChar,
                    System.IO.Path.AltDirectorySeparatorChar));
            }
            else
            {
                var fileDialog = new Microsoft.Win32.OpenFileDialog
                {
                    Title = "选择要导入的笔记文件",
                    Filter = "支持的笔记 (*.enex;*.json;*.csv;*.md;*.txt;*.html)|*.enex;*.json;*.csv;*.md;*.markdown;*.txt;*.html;*.htm|ENEX (*.enex)|*.enex|Google Keep JSON (*.json)|*.json|所有文件 (*.*)|*.*",
                    Multiselect = true,
                    CheckFileExists = true,
                };
                if (fileDialog.ShowDialog(this) != true)
                {
                    return;
                }
                sourcePaths = fileDialog.FileNames;
            }

            await CaptureEditorSnapshotAsync();
            if (!await _viewModel.FlushAllAsync())
            {
                throw new InvalidOperationException("当前笔记尚未保存，已取消导入。");
            }
            if (sourceRoot is not null)
            {
                await _viewModel.CreateNotebookAsync(
                    string.IsNullOrWhiteSpace(importNotebookName) ? "导入的笔记" : importNotebookName);
            }

            var result = await _importService.ImportAsync(new NoteImportRequest
            {
                SourcePaths = sourcePaths,
                NotebookId = _viewModel.SelectedNotebook?.Kind == NotebookKind.User
                    ? _viewModel.SelectedNotebook.Id
                    : null,
                SourceRoot = sourceRoot,
                PrefixRelativeDirectory = prefixRelativeDirectory,
            });
            await _viewModel.RefreshAfterSyncAsync();

            foreach (var failure in result.Failures)
            {
                _logger.Error($"Import failed for {failure.SourcePath}.", new System.IO.InvalidDataException(failure.Message));
            }

            var details = new List<string>
            {
                $"成功导入 {result.ImportedCount} 篇，失败 {result.FailedCount} 篇。",
            };
            if (result.Warnings.Count > 0)
            {
                details.Add($"提示：{string.Join("；", result.Warnings.Take(3))}");
            }
            if (result.Failures.Count > 0)
            {
                details.Add("失败文件：" + string.Join("；", result.Failures.Take(5).Select(failure =>
                    $"{System.IO.Path.GetFileName(failure.SourcePath)}（{failure.Message}）")));
            }
            MessageBox.Show(this, string.Join(Environment.NewLine + Environment.NewLine, details), "导入完成",
                MessageBoxButton.OK,
                result.FailedCount == 0 ? MessageBoxImage.Information : MessageBoxImage.Warning);
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to import notes.", exception);
            MessageBox.Show(this, $"导入失败：{exception.Message}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private static bool IsSupportedImportPath(string path) =>
        System.IO.Path.GetExtension(path).ToLowerInvariant()
            is ".md" or ".markdown" or ".txt" or ".html" or ".htm" or ".enex" or ".json" or ".csv";

    private static IReadOnlyList<string> RemovePairedHtmlFiles(IReadOnlyList<string> paths)
    {
        var jsonStems = paths
            .Where(path => System.IO.Path.GetExtension(path).Equals(".json", StringComparison.OrdinalIgnoreCase))
            .Select(path => System.IO.Path.ChangeExtension(path, null))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return paths.Where(path =>
            System.IO.Path.GetExtension(path).ToLowerInvariant() is not (".html" or ".htm") ||
            !jsonStems.Contains(System.IO.Path.ChangeExtension(path, null)))
            .ToArray();
    }

    private async void OnRestoreBackupClick(object sender, RoutedEventArgs e)
    {
        var archiveDialog = new Microsoft.Win32.OpenFileDialog
        {
            Title = "选择 LightNote 备份",
            Filter = "LightNote 备份 (*.zip)|*.zip",
            CheckFileExists = true,
        };
        if (archiveDialog.ShowDialog(this) != true)
        {
            return;
        }

        var folderDialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "选择一个空目录保存恢复的数据",
            Multiselect = false,
        };
        if (folderDialog.ShowDialog(this) != true)
        {
            return;
        }

        try
        {
            await _backupService.RestoreAsync(archiveDialog.FileName, folderDialog.FolderName);
            MessageBox.Show(this, $"备份已安全恢复到：\n{folderDialog.FolderName}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to restore a backup.", exception);
            MessageBox.Show(this, $"恢复失败：{exception.Message}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void OnExportNoteClick(object sender, RoutedEventArgs e)
    {
        var note = _viewModel.SelectedNote?.Model;
        if (note is null || _viewModel.IsTrashSelected)
        {
            return;
        }

        try
        {
            await CaptureEditorSnapshotAsync();
            if (!await _viewModel.FlushAllAsync())
            {
                throw new InvalidOperationException("当前笔记尚未保存。");
            }

            note = _viewModel.SelectedNote?.Model ?? note;
            var safeTitle = string.Concat(note.Title.Select(character =>
                System.IO.Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                Title = "导出笔记",
                FileName = string.IsNullOrWhiteSpace(safeTitle) ? "LightNote 笔记" : safeTitle,
                Filter = "网页 (*.html)|*.html|Markdown (*.md)|*.md|纯文本 (*.txt)|*.txt",
                AddExtension = true,
                OverwritePrompt = true,
            };
            if (dialog.ShowDialog(this) != true)
            {
                return;
            }

            var format = dialog.FilterIndex switch
            {
                2 => LightNote.Core.Models.NoteExportFormat.Markdown,
                3 => LightNote.Core.Models.NoteExportFormat.PlainText,
                _ => LightNote.Core.Models.NoteExportFormat.Html,
            };
            await _exportService.ExportAsync(note, format, dialog.FileName);
            MessageBox.Show(this, $"笔记已导出：\n{dialog.FileName}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to export a note.", exception);
            MessageBox.Show(this, "导出失败，请查看日志。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnOpenLogsClick(object sender, RoutedEventArgs e)
    {
        try
        {
            _paths.EnsureCreated();
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = _paths.LogsDirectory,
                UseShellExecute = true,
            });
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to open the logs directory.", exception);
            MessageBox.Show(this, $"无法打开日志目录：\n{_paths.LogsDirectory}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OnSettingsClick(object sender, RoutedEventArgs e) =>
        OpenSettings(SettingsSection.General);

    private void OnDataSafetyClick(object sender, RoutedEventArgs e) =>
        OpenSettings(SettingsSection.Safety);

    private void OpenSettings(SettingsSection initialSection)
    {
        var dialog = new SettingsDialog(
            _settings,
            _paths,
            _connectionFactory,
            _integrityChecker,
            _backupService,
            _viewModel.SyncStatus,
            _viewModel.SelectedNote is not null && !_viewModel.IsTrashSelected,
            initialSection,
            _syncService.CurrentAccount?.Email)
        {
            Owner = this,
        };
        if (dialog.ShowDialog() != true)
        {
            return;
        }

        if (dialog.SettingsSaved)
        {
            try
            {
                _settings = dialog.Settings;
                _settingsService.Save(_settings);
                ApplyTheme();
                _viewModel.ConfigureNavigation(
                    _settings.ShowRecentNavigation,
                    _settings.ShowPinnedNavigation,
                    _settings.ShowTrashNavigation);
            }
            catch (Exception exception)
            {
                _logger.Error("Failed to save application settings.", exception);
                MessageBox.Show(this, $"设置未能保存：{exception.Message}", "LightNote",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }

        switch (dialog.RequestedAction)
        {
            case SettingsAction.Import:
                OnImportClick(this, new RoutedEventArgs());
                break;
            case SettingsAction.ExportCurrentNote:
                OnExportNoteClick(this, new RoutedEventArgs());
                break;
            case SettingsAction.CreateBackup:
                OnBackupClick(this, new RoutedEventArgs());
                break;
            case SettingsAction.RestoreBackup:
                OnRestoreBackupClick(this, new RoutedEventArgs());
                break;
        }
    }

    private void ApplyTheme()
    {
        _themeService.Apply(_settings.Theme);
        EditorWebView.DefaultBackgroundColor = _themeService.IsDark
            ? System.Drawing.Color.FromArgb(32, 35, 40)
            : System.Drawing.Color.White;
        if (EditorWebView.CoreWebView2 is not null)
        {
            EditorWebView.CoreWebView2.Profile.PreferredColorScheme = _themeService.IsDark
                ? CoreWebView2PreferredColorScheme.Dark
                : CoreWebView2PreferredColorScheme.Light;
        }
    }

    public void ShowAndActivate()
    {
        if (!IsVisible)
        {
            Show();
        }

        if (WindowState == WindowState.Minimized)
        {
            WindowState = WindowState.Normal;
        }

        Activate();
        Topmost = true;
        Topmost = false;
        Focus();
    }

    private void ApplyWindowSettings()
    {
        Width = _settings.WindowWidth;
        Height = _settings.WindowHeight;
        NotebookColumn.Width = new GridLength(_settings.NotebookPaneWidth);
        NoteListColumn.Width = new GridLength(_settings.NoteListPaneWidth);

        if (double.IsFinite(_settings.WindowLeft) && double.IsFinite(_settings.WindowTop) &&
            _settings.WindowLeft < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 80 &&
            _settings.WindowTop < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 80 &&
            _settings.WindowLeft + Width > SystemParameters.VirtualScreenLeft + 80 &&
            _settings.WindowTop + Height > SystemParameters.VirtualScreenTop + 80)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = _settings.WindowLeft;
            Top = _settings.WindowTop;
        }

        if (_settings.WindowMaximized)
        {
            WindowState = WindowState.Maximized;
        }
    }

    private void SaveWindowSettings()
    {
        var bounds = WindowState == WindowState.Maximized ? RestoreBounds : new Rect(Left, Top, Width, Height);
        _settings = _settings with
        {
            WindowLeft = bounds.Left,
            WindowTop = bounds.Top,
            WindowWidth = bounds.Width,
            WindowHeight = bounds.Height,
            WindowMaximized = WindowState == WindowState.Maximized,
            NotebookPaneWidth = NotebookColumn.ActualWidth,
            NoteListPaneWidth = NoteListColumn.ActualWidth,
        };
        _settingsService.Save(_settings);
    }

    private async Task InitializeSyncAsync()
    {
        if (!_syncService.IsConfigured)
        {
            _viewModel.SyncStatus = "同步未配置";
            UpdateAccountDisplay(null);
            return;
        }

        var account = await _syncService.RestoreSessionAsync();
        if (account is null)
        {
            _viewModel.SyncStatus = "登录同步";
            UpdateAccountDisplay(null);
            return;
        }

        _viewModel.SyncStatus = $"同步：{account.Email}";
        UpdateAccountDisplay(account);
        _syncTimer.Start();
        await RunSyncAsync(silent: true);
    }

    private async void OnSyncClick(object sender, RoutedEventArgs e)
    {
        if (!_syncService.IsConfigured)
        {
            MessageBox.Show(this,
                $"Firebase 尚未配置。配置文件稍后应放在：\n{_syncService.ConfigurationPath}\n\n" +
                "需要 projectId、apiKey 和 storageBucket。",
                "LightNote",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        if (_syncService.CurrentAccount is null)
        {
            var dialog = new FirebaseSignInDialog { Owner = this };
            if (dialog.ShowDialog() != true)
            {
                return;
            }

            try
            {
                _viewModel.SyncStatus = "正在登录…";
                var account = await _syncService.SignInAsync(dialog.Email, dialog.Password);
                _viewModel.SyncStatus = $"同步：{account.Email}";
                UpdateAccountDisplay(account);
                _syncTimer.Start();
            }
            catch (Exception exception)
            {
                _logger.Error("Firebase sign-in failed.", exception);
                _viewModel.SyncStatus = "登录失败";
                MessageBox.Show(this, $"登录失败：{exception.Message}", "LightNote",
                    MessageBoxButton.OK, MessageBoxImage.Error);
                return;
            }
        }

        await RunSyncAsync(silent: false);
    }

    private async void OnSignOutClick(object sender, RoutedEventArgs e)
    {
        try
        {
            await _syncService.SignOutAsync();
            _syncTimer.Stop();
            _viewModel.SyncStatus = "登录同步";
            UpdateAccountDisplay(null);
        }
        catch (Exception exception)
        {
            _logger.Error("Firebase sign-out failed.", exception);
            MessageBox.Show(this, $"退出登录失败：{exception.Message}", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void UpdateAccountDisplay(FirebaseAccount? account)
    {
        if (account is null)
        {
            AccountButtonText.Text = "Google 登录";
            AccountButton.ToolTip = "登录 Google 账户以同步笔记";
            if (IsLoaded)
            {
                ConfigureAccountPopup();
            }
            return;
        }

        AccountButtonText.Text = account.Email;
        AccountButton.ToolTip = $"{account.Email}\n点击打开账户菜单";
        if (IsLoaded)
        {
            ConfigureAccountPopup();
        }
    }

    private async Task RunSyncAsync(bool silent)
    {
        if (_syncInProgress || _syncService.CurrentAccount is null)
        {
            return;
        }

        _syncInProgress = true;
        try
        {
            await CaptureEditorSnapshotAsync();
            if (!await _viewModel.FlushAllAsync())
            {
                throw new InvalidOperationException("仍有内容未能保存，已暂停同步。");
            }

            _viewModel.SyncStatus = "正在同步…";
            var result = await _syncService.SyncAsync();
            await _viewModel.RefreshAfterSyncAsync();
            _viewModel.SyncStatus = result.Conflicts > 0
                ? $"已同步 · {result.Conflicts} 个冲突副本"
                : $"已同步 · {result.CompletedAt.ToLocalTime():HH:mm}";
            if (!silent)
            {
                MessageBox.Show(this,
                    $"同步完成：上传 {result.Uploaded}，下载 {result.Downloaded}，冲突副本 {result.Conflicts}。",
                    "LightNote",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
            }
        }
        catch (Exception exception)
        {
            _logger.Error("Firebase sync failed.", exception);
            _viewModel.SyncStatus = "同步失败 · 将自动重试";
            if (!silent)
            {
                MessageBox.Show(this, $"同步失败：{exception.Message}", "LightNote",
                    MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
        finally
        {
            _syncInProgress = false;
        }
    }

    private void OnFindExecuted(object sender, ExecutedRoutedEventArgs e)
    {
        SearchBox.Focus();
        SearchBox.SelectAll();
        e.Handled = true;
    }

    private sealed record NotebookGroupAssignment(string NotebookId, string? GroupId);
}

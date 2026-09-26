using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Settings;
using LightNote.Infrastructure.Storage;
using Microsoft.Web.WebView2.Core;
using Button = System.Windows.Controls.Button;

namespace LightNote.App;

public partial class NoteWindow : Window
{
    private const string EditorHostName = "lightnote.editor";
    private const string AttachmentHostName = "lightnote.attachments";
    private readonly Note _note;
    private readonly MainViewModel _viewModel;
    private readonly AppDataPaths _paths;
    private readonly IAppLogger _logger;
    private readonly IAttachmentService _attachmentService;
    private readonly ThemeService _themeService;
    private bool _editorReady;
    private bool _initializingTitle = true;
    private bool _allowClose;
    private bool _closing;

    public NoteWindow(
        Note note,
        MainViewModel viewModel,
        AppDataPaths paths,
        IAppLogger logger,
        IAttachmentService attachmentService,
        ThemeService themeService)
    {
        InitializeComponent();
        _note = note;
        _viewModel = viewModel;
        _paths = paths;
        _logger = logger;
        _attachmentService = attachmentService;
        _themeService = themeService;
        Title = $"{note.Title} - LightNote";
        TitleBox.Text = note.Title;
        TagsText.Text = viewModel.SelectedTagsDisplay;
        TagsText.Visibility = string.IsNullOrWhiteSpace(TagsText.Text)
            ? Visibility.Collapsed
            : Visibility.Visible;
        _initializingTitle = false;
        Loaded += OnLoaded;
        Closing += OnClosing;
        Closed += (_, _) => EditorWebView.Dispose();
        SourceInitialized += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        WindowNativeHelper.ApplyNativeFrame(this);
        try
        {
            await InitializeEditorAsync();
        }
        catch (Exception exception)
        {
            _logger.Error($"Failed to initialize note window for {_note.Id}.", exception);
            MessageBox.Show(this, "独立笔记窗口的编辑器启动失败，请查看日志。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async Task InitializeEditorAsync()
    {
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
        EditorWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            EditorHostName, editorDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
        EditorWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
            AttachmentHostName, _paths.AttachmentsDirectory, CoreWebView2HostResourceAccessKind.DenyCors);
        EditorWebView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        EditorWebView.CoreWebView2.NavigationCompleted += (_, args) =>
        {
            if (args.IsSuccess)
            {
                PostEditorMessage(new { type = "theme.changed", payload = new { isDark = _themeService.IsDark } });
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
                    SendNote();
                    break;
                case "note.changed":
                    if (message.RootElement.TryGetProperty("payload", out var payload))
                    {
                        ApplyEditorPayload(payload);
                    }
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
            _logger.Error($"Invalid editor message in note window {_note.Id}.", exception);
        }
    }

    private void SendNote()
    {
        if (!_editorReady || EditorWebView.CoreWebView2 is null)
        {
            return;
        }

        using var bodyJson = JsonDocument.Parse(_note.BodyJson);
        PostEditorMessage(new
        {
            type = "note.load",
            payload = new
            {
                id = _note.Id,
                title = _note.Title,
                json = bodyJson.RootElement,
                html = _note.BodyHtml,
                text = _note.BodyText,
            },
        });
    }

    private void ApplyEditorPayload(JsonElement payload)
    {
        var bodyJson = payload.TryGetProperty("json", out var jsonElement)
            ? jsonElement.GetRawText()
            : "{\"type\":\"doc\",\"content\":[]}";
        var bodyHtml = payload.TryGetProperty("html", out var htmlElement)
            ? htmlElement.GetString() ?? string.Empty
            : string.Empty;
        var bodyText = payload.TryGetProperty("text", out var textElement)
            ? textElement.GetString() ?? string.Empty
            : string.Empty;
        _viewModel.ApplyEditorChange(_note.Id, bodyJson, bodyHtml, bodyText);
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
            if (string.IsNullOrWhiteSpace(requestId) || base64.Length == 0 || base64.Length > 28_000_000)
            {
                throw new System.IO.InvalidDataException("图片消息缺少必要内容或超过 20 MB 限制。");
            }

            var imported = await _attachmentService.ImportAsync(
                _note.Id, fileName, mimeType, Convert.FromBase64String(base64));
            var escapedPath = string.Join("/", imported.RelativePath.Split('/').Select(Uri.EscapeDataString));
            PostEditorMessage(new
            {
                type = "attachment.created",
                payload = new
                {
                    requestId,
                    noteId = _note.Id,
                    id = imported.Id,
                    url = $"https://{AttachmentHostName}/{escapedPath}",
                    imported.Width,
                    imported.Height,
                },
            });
        }
        catch (Exception exception)
        {
            _logger.Error($"Failed to import an image in note window {_note.Id}.", exception);
            PostEditorMessage(new
            {
                type = "attachment.error",
                payload = new { requestId, message = "图片保存失败，请查看日志。" },
            });
        }
    }

    private void OnTitleChanged(object sender, TextChangedEventArgs e)
    {
        if (_initializingTitle)
        {
            return;
        }

        _viewModel.ApplyNoteTitleChange(_note.Id, TitleBox.Text);
        Title = $"{(string.IsNullOrWhiteSpace(TitleBox.Text) ? "无标题笔记" : TitleBox.Text.Trim())} - LightNote";
    }

    private void OnTitlePreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.ImeProcessed)
        {
            return;
        }

        if ((e.Key == Key.Tab && Keyboard.Modifiers == ModifierKeys.None) || e.Key == Key.Enter)
        {
            e.Handled = true;
            FocusEditor();
        }
    }

    public async void FocusEditor(string? position = "start")
    {
        EditorWebView.Focus();
        if (!_editorReady || EditorWebView.CoreWebView2 is null)
        {
            return;
        }

        try
        {
            var script = string.IsNullOrWhiteSpace(position)
                ? "window.lightNoteEditor ? window.lightNoteEditor.focus() : (document.querySelector('.ProseMirror')?.focus())"
                : $"window.lightNoteEditor ? window.lightNoteEditor.focus('{position}') : (document.querySelector('.ProseMirror')?.focus())";
            await EditorWebView.CoreWebView2.ExecuteScriptAsync(script);
        }
        catch (Exception exception)
        {
            _logger.Error("Failed to focus editor via script.", exception);
        }
    }

    private void OnEditorCommandClick(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string command } && _editorReady)
        {
            PostEditorMessage(new { type = "editor.command", payload = new { command } });
        }
    }

    private void OnEditorFontFamilyChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_editorReady && FontFamilyBox.SelectedItem is ComboBoxItem { Tag: string value })
        {
            PostEditorMessage(new { type = "editor.command", payload = new { command = "fontFamily", value } });
        }
    }

    private void OnEditorFontSizeChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_editorReady && FontSizeBox.SelectedItem is ComboBoxItem { Tag: string value })
        {
            PostEditorMessage(new { type = "editor.command", payload = new { command = "fontSize", value } });
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
        var block = state.TryGetProperty("block", out var blockElement) ? blockElement.GetString() : "p";
        SetFormattingButtonState(ParagraphButton, block == "p");
        SetFormattingButtonState(Heading1Button, block == "h1");
        SetFormattingButtonState(Heading2Button, block == "h2");
        SetFormattingButtonState(QuoteButton, block == "blockquote");
        SetFormattingButtonState(CodeBlockButton, block == "pre");
    }

    private void SetFormattingButtonState(Button button, bool isActive)
    {
        button.Background = isActive ? (Brush)FindResource("AccentLightBrush") : Brushes.Transparent;
        button.Foreground = isActive ? (Brush)FindResource("AccentBrush") : (Brush)FindResource("TextBrush");
    }

    private void PostEditorMessage(object message) =>
        EditorWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message));

    private static bool ReadBoolean(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.True;

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
        if (_closing)
        {
            return;
        }

        _closing = true;
        try
        {
            await CaptureEditorSnapshotAsync();
            if (!await _viewModel.FlushAllAsync())
            {
                throw new InvalidOperationException("笔记尚未保存完成。");
            }
            _allowClose = true;
            Close();
        }
        catch (Exception exception)
        {
            _logger.Error($"Failed to save note window {_note.Id} before close.", exception);
            MessageBox.Show(this, "关闭前保存失败，窗口将保持打开。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _closing = false;
        }
    }
}

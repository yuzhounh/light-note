using System.Windows;
using LightNote.Core.Abstractions;

namespace LightNote.App;

public partial class FirebaseSignInDialog : Window
{
    private readonly IFirebaseSyncService? _syncService;
    private readonly IAppLogger? _logger;
    private CancellationTokenSource? _cancellationTokenSource;

    public FirebaseSignInDialog() : this(null, null)
    {
    }

    public FirebaseSignInDialog(IFirebaseSyncService? syncService, IAppLogger? logger)
    {
        InitializeComponent();
        _syncService = syncService;
        _logger = logger;

        if (_syncService?.GoogleClientId is { Length: > 0 } configuredClientId)
        {
            GoogleClientIdBox.Text = configuredClientId;
            GoogleConfigPanel.Visibility = Visibility.Collapsed;
        }
        else
        {
            GoogleConfigPanel.Visibility = Visibility.Visible;
        }

        SourceInitialized += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);

        Loaded += (_, _) =>
        {
            WindowNativeHelper.ApplyNativeFrame(this);
            if (GoogleConfigPanel.Visibility == Visibility.Visible && string.IsNullOrWhiteSpace(GoogleClientIdBox.Text))
            {
                GoogleClientIdBox.Focus();
            }
            else
            {
                GoogleSignInButton.Focus();
            }
        };
    }

    public string Email => EmailBox.Text.Trim();

    public string Password => PasswordBox.Password;

    private async void OnGoogleSignInClick(object sender, RoutedEventArgs e)
    {
        if (_syncService is null)
        {
            DialogResult = true;
            return;
        }

        var clientId = GoogleClientIdBox.Text.Trim();
        var clientSecret = GoogleClientSecretBox.Password.Trim();

        if (string.IsNullOrWhiteSpace(clientId))
        {
            GoogleConfigPanel.Visibility = Visibility.Visible;
            GoogleClientIdBox.Focus();
            MessageBox.Show(this,
                "使用 Google 登录需要填写 Google OAuth 客户端 ID (Client ID)。\n\n" +
                "请在 Google Cloud 控制台凭据页面创建一个「桌面应用」类型的客户端 ID。",
                "提示",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        SetInProgress(true, "正在等待浏览器授权…");
        _cancellationTokenSource = new CancellationTokenSource();

        try
        {
            await _syncService.SignInWithGoogleAsync(
                clientId,
                clientSecret,
                cancellationToken: _cancellationTokenSource.Token);

            DialogResult = true;
        }
        catch (OperationCanceledException)
        {
            // User cancelled
        }
        catch (Exception exception)
        {
            _logger?.Error("Google Sign-In failed.", exception);
            MessageBox.Show(this,
                $"Google 登录失败：{exception.Message}",
                "LightNote",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            _cancellationTokenSource?.Dispose();
            _cancellationTokenSource = null;
            SetInProgress(false);
        }
    }

    private async void OnEmailSignInClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrEmpty(Password))
        {
            MessageBox.Show(this, "请输入邮箱和密码。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        if (_syncService is null)
        {
            DialogResult = true;
            return;
        }

        SetInProgress(true, "正在验证邮箱与密码…");
        _cancellationTokenSource = new CancellationTokenSource();

        try
        {
            await _syncService.SignInAsync(Email, Password, _cancellationTokenSource.Token);
            DialogResult = true;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            _logger?.Error("Email Sign-In failed.", exception);
            MessageBox.Show(this,
                $"登录失败：{exception.Message}",
                "LightNote",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
        finally
        {
            _cancellationTokenSource?.Dispose();
            _cancellationTokenSource = null;
            SetInProgress(false);
        }
    }

    private void OnCancelClick(object sender, RoutedEventArgs e)
    {
        if (_cancellationTokenSource is not null)
        {
            _cancellationTokenSource.Cancel();
            return;
        }

        DialogResult = false;
    }

    private void SetInProgress(bool inProgress, string? message = null)
    {
        ProgressPanel.Visibility = inProgress ? Visibility.Visible : Visibility.Collapsed;
        if (message is not null)
        {
            ProgressText.Text = message;
        }

        GoogleSignInButton.IsEnabled = !inProgress;
        EmailSignInButton.IsEnabled = !inProgress;
        EmailBox.IsEnabled = !inProgress;
        PasswordBox.IsEnabled = !inProgress;
        GoogleClientIdBox.IsEnabled = !inProgress;
        GoogleClientSecretBox.IsEnabled = !inProgress;
    }
}

using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace LightNote.App;

public partial class MessageDialog : Window
{
    private readonly MessageBoxResult _dismissResult;
    private Button? _defaultButton;

    public MessageDialog(string message, string caption, MessageBoxButton buttons = MessageBoxButton.OK,
        MessageBoxImage image = MessageBoxImage.None, MessageBoxResult defaultResult = MessageBoxResult.None)
    {
        InitializeComponent();
        Title = caption;
        MessageText.Text = message;
        MaxHeight = Math.Max(180, SystemParameters.WorkArea.Height - 40);
        MaxWidth = Math.Max(240, SystemParameters.WorkArea.Width - 40);
        _dismissResult = buttons switch
        {
            MessageBoxButton.YesNo => MessageBoxResult.No,
            MessageBoxButton.OK => MessageBoxResult.OK,
            _ => MessageBoxResult.Cancel,
        };
        Result = _dismissResult;

        SymbolText.Text = image switch
        {
            MessageBoxImage.Question => "\uE9CE",
            MessageBoxImage.Warning => "\uE7BA",
            MessageBoxImage.Error => "\uEA39",
            _ => "\uE946",
        };
        SymbolPanel.Visibility = image == MessageBoxImage.None ? Visibility.Collapsed : Visibility.Visible;

        var primaryResult = buttons is MessageBoxButton.YesNo or MessageBoxButton.YesNoCancel
            ? MessageBoxResult.Yes : MessageBoxResult.OK;
        if (defaultResult == MessageBoxResult.None)
        {
            defaultResult = primaryResult;
        }
        if (buttons is MessageBoxButton.OKCancel or MessageBoxButton.YesNoCancel)
        {
            AddButton("取消", MessageBoxResult.Cancel, defaultResult, primaryResult);
        }
        if (buttons is MessageBoxButton.YesNo or MessageBoxButton.YesNoCancel)
        {
            AddButton("否(_N)", MessageBoxResult.No, defaultResult, primaryResult);
            AddButton("是(_Y)", MessageBoxResult.Yes, defaultResult, primaryResult);
        }
        else
        {
            AddButton("确定", MessageBoxResult.OK, defaultResult, primaryResult);
        }

        SourceInitialized += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Loaded += (_, _) =>
        {
            WindowNativeHelper.ApplyNativeFrame(this);
            _defaultButton?.Focus();
        };
    }

    public MessageBoxResult Result { get; private set; }

    public static MessageBoxResult Show(string message, string caption,
        MessageBoxButton buttons = MessageBoxButton.OK, MessageBoxImage image = MessageBoxImage.None,
        MessageBoxResult defaultResult = MessageBoxResult.None)
        => Show(null, message, caption, buttons, image, defaultResult);

    public static MessageBoxResult Show(Window? owner, string message, string caption,
        MessageBoxButton buttons = MessageBoxButton.OK, MessageBoxImage image = MessageBoxImage.None,
        MessageBoxResult defaultResult = MessageBoxResult.None)
    {
        var dialog = new MessageDialog(message, caption, buttons, image, defaultResult);
        owner ??= Application.Current?.Windows.OfType<Window>().FirstOrDefault(window => window.IsActive)
            ?? Application.Current?.MainWindow;
        if (owner is { IsVisible: true })
        {
            dialog.Owner = owner;
        }
        else
        {
            dialog.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        }
        dialog.ShowDialog();
        return dialog.Result;
    }

    private void AddButton(string text, MessageBoxResult result, MessageBoxResult defaultResult,
        MessageBoxResult primaryResult)
    {
        var button = new Button { Content = text, IsDefault = result == defaultResult, Tag = result };
        button.SetResourceReference(StyleProperty,
            result == primaryResult ? "DialogPrimaryButtonStyle" : "DialogButtonStyle");
        button.Click += (_, _) =>
        {
            Result = result;
            DialogResult = result is MessageBoxResult.OK or MessageBoxResult.Yes;
        };
        ButtonPanel.Children.Add(button);
        if (button.IsDefault)
        {
            _defaultButton = button;
        }
    }

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Result = _dismissResult;
            e.Handled = true;
            Close();
        }
    }
}

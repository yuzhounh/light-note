using System.Windows;

namespace LightNote.App;

public partial class TextPromptDialog : Window
{
    private readonly bool _allowEmpty;

    public TextPromptDialog(
        string title,
        string prompt,
        string initialValue = "",
        bool allowEmpty = false)
    {
        InitializeComponent();
        _allowEmpty = allowEmpty;
        Title = title;
        PromptText.Text = prompt;
        ValueTextBox.Text = initialValue;
        SourceInitialized += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Loaded += (_, _) =>
        {
            WindowNativeHelper.ApplyNativeFrame(this);
            ValueTextBox.Focus();
            ValueTextBox.SelectAll();
        };
    }

    public string Value => ValueTextBox.Text.Trim();

    private void OnAcceptClick(object sender, RoutedEventArgs e)
    {
        if (!_allowEmpty && string.IsNullOrWhiteSpace(ValueTextBox.Text))
        {
            ValueTextBox.Focus();
            return;
        }

        DialogResult = true;
    }
}

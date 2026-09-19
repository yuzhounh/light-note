using System.Windows;

namespace LightNote.App;

public partial class FirebaseSignInDialog : Window
{
    public FirebaseSignInDialog()
    {
        InitializeComponent();
        Loaded += (_, _) => EmailBox.Focus();
    }

    public string Email => EmailBox.Text.Trim();

    public string Password => PasswordBox.Password;

    private void OnSignInClick(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(Email) || string.IsNullOrEmpty(Password))
        {
            MessageBox.Show(this, "请输入邮箱和密码。", "LightNote",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        DialogResult = true;
    }
}

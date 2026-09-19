using System.Windows;

namespace LightNote.App;

public partial class ImportSourceDialog : Window
{
    public ImportSourceDialog()
    {
        InitializeComponent();
    }

    public ImportSourceKind SelectedSourceKind { get; private set; }

    private void OnFilesClick(object sender, RoutedEventArgs e)
    {
        SelectedSourceKind = ImportSourceKind.Files;
        DialogResult = true;
    }

    private void OnFolderClick(object sender, RoutedEventArgs e)
    {
        SelectedSourceKind = ImportSourceKind.Folder;
        DialogResult = true;
    }
}

public enum ImportSourceKind
{
    Files,
    Folder,
}

using System.Windows;

namespace LightNote.App;

public partial class ImportSourceDialog : Window
{
    public ImportSourceDialog()
    {
        InitializeComponent();
        SourceInitialized += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Loaded += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
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

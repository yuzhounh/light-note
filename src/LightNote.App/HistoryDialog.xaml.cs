using System.Windows;
using System.Windows.Controls;
using LightNote.Core.Models;

namespace LightNote.App;

public partial class HistoryDialog : Window
{
    public HistoryDialog(IReadOnlyList<NoteVersion> versions, Note currentNote)
    {
        InitializeComponent();
        SourceInitialized += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Activated += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        Loaded += (_, _) => WindowNativeHelper.ApplyNativeFrame(this);
        DataContext = versions.Select(version => new HistoryItem(version)).ToArray();
        CurrentTitleText.Text = currentNote.Title;
        CurrentBodyText.Text = string.IsNullOrWhiteSpace(currentNote.BodyText) ? "空笔记" : currentNote.BodyText;
        VersionsList.SelectedIndex = versions.Count > 0 ? 0 : -1;
    }

    public string? SelectedVersionId =>
        (VersionsList.SelectedItem as HistoryItem)?.Snapshot.Id;

    private void OnRestoreClick(object sender, RoutedEventArgs e)
    {
        if (SelectedVersionId is null)
        {
            MessageBox.Show(
                this,
                "请先选择一个历史版本。",
                "LightNote",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            return;
        }

        DialogResult = true;
    }

    private void OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (VersionsList.SelectedItem is not HistoryItem selected)
        {
            SelectedTitleText.Text = string.Empty;
            SelectedBodyText.Text = string.Empty;
            return;
        }

        SelectedTitleText.Text = selected.Snapshot.IsConflict
            ? $"{selected.Title}（同步冲突副本）"
            : selected.Title;
        SelectedBodyText.Text = string.IsNullOrWhiteSpace(selected.Snapshot.BodyText)
            ? "空笔记"
            : selected.Snapshot.BodyText;
    }

    private sealed record HistoryItem(NoteVersion Snapshot)
    {
        public long Version => Snapshot.Version;

        public string Title => Snapshot.Title;

        public string CreatedLabel =>
            $"{Snapshot.CreatedAt.ToLocalTime():yyyy-MM-dd HH:mm:ss}{(Snapshot.IsConflict ? " · 同步冲突副本" : string.Empty)}";

        public string Preview => string.IsNullOrWhiteSpace(Snapshot.BodyText)
            ? "空笔记"
            : Snapshot.BodyText.ReplaceLineEndings(" ");
    }
}

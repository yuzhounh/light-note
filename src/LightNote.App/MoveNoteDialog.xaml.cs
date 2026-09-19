using System.Windows;

namespace LightNote.App;

public partial class MoveNoteDialog : Window
{
    public MoveNoteDialog(IReadOnlyList<MoveDestination> destinations, string? currentNotebookId)
    {
        InitializeComponent();
        DestinationBox.ItemsSource = destinations;
        DestinationBox.SelectedItem = destinations.FirstOrDefault(item => item.Id == currentNotebookId)
            ?? destinations.FirstOrDefault();
    }

    public string? SelectedNotebookId => (DestinationBox.SelectedItem as MoveDestination)?.Id;

    private void OnMoveClick(object sender, RoutedEventArgs e)
    {
        if (DestinationBox.SelectedItem is null)
        {
            return;
        }

        DialogResult = true;
    }
}

public sealed record MoveDestination(string? Id, string Name);

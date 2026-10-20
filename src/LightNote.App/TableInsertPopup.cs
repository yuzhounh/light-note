using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using Button = System.Windows.Controls.Button;
using TextBox = System.Windows.Controls.TextBox;

namespace LightNote.App;

internal static class TableInsertPopup
{
    public static void Show(Button anchor, Action<int, int> insert)
    {
        var rows = new TextBox { Text = "3", MinHeight = 32, Padding = new Thickness(6, 4, 6, 4) };
        var cols = new TextBox { Text = "3", MinHeight = 32, Padding = new Thickness(6, 4, 6, 4) };
        var content = new StackPanel { Width = 204 };
        foreach (var (label, input, maximum) in new[] { ("行数", rows, 100), ("列数", cols, 30) })
        {
            var field = new Grid { Margin = new Thickness(0, 0, 0, 8) };
            field.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(36) });
            field.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(80) });
            field.ColumnDefinitions.Add(new ColumnDefinition());
            field.Children.Add(new TextBlock { Text = label, VerticalAlignment = VerticalAlignment.Center });
            input.SetResourceReference(Control.BackgroundProperty, "PanelBrush");
            input.SetResourceReference(Control.ForegroundProperty, "TextBrush");
            input.SetResourceReference(Control.BorderBrushProperty, "BorderBrush");
            Grid.SetColumn(input, 1);
            field.Children.Add(input);
            var hint = new TextBlock { Text = $"最大 {maximum}", FontSize = 11, Margin = new Thickness(10, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            hint.SetResourceReference(TextBlock.ForegroundProperty, "MutedTextBrush");
            Grid.SetColumn(hint, 2);
            field.Children.Add(hint);
            content.Children.Add(field);
        }
        var apply = new Button { Content = "插入", HorizontalAlignment = HorizontalAlignment.Right, MinWidth = 60, MinHeight = 32 };
        apply.SetResourceReference(FrameworkElement.StyleProperty, "DialogPrimaryButtonStyle");
        content.Children.Add(apply);
        var card = new Border { Child = content, Padding = new Thickness(12), CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(1) };
        card.SetResourceReference(Border.BackgroundProperty, "PanelBrush");
        card.SetResourceReference(Border.BorderBrushProperty, "BorderBrush");
        TextElement.SetForeground(card, (System.Windows.Media.Brush)anchor.FindResource("TextBrush"));
        var popup = new Popup
        {
            PlacementTarget = anchor,
            Placement = PlacementMode.Custom,
            CustomPopupPlacementCallback = (_, targetSize, _) =>
                [new CustomPopupPlacement(new Point(0, targetSize.Height + 4), PopupPrimaryAxis.Horizontal)],
            StaysOpen = false,
            AllowsTransparency = true,
            Child = card,
        };
        void Apply()
        {
            if (!int.TryParse(rows.Text, out var rowCount) || rowCount is < 1 or > 100) { rows.Focus(); rows.SelectAll(); return; }
            if (!int.TryParse(cols.Text, out var colCount) || colCount is < 1 or > 30) { cols.Focus(); cols.SelectAll(); return; }
            popup.IsOpen = false;
            insert(rowCount, colCount);
        }
        apply.Click += (_, _) => Apply();
        card.PreviewKeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape) { popup.IsOpen = false; anchor.Focus(); e.Handled = true; }
            else if (e.Key == Key.Enter) { Apply(); e.Handled = true; }
        };
        popup.Opened += (_, _) => { rows.Focus(); rows.SelectAll(); };
        popup.IsOpen = true;
    }
}

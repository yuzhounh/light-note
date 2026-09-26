using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace LightNote.App;

public sealed class HighlightedTextBlock : TextBlock
{
    public static readonly DependencyProperty HighlightTextProperty = DependencyProperty.Register(
        nameof(HighlightText),
        typeof(string),
        typeof(HighlightedTextBlock),
        new PropertyMetadata(string.Empty, OnHighlightChanged));

    public static readonly DependencyProperty HighlightQueryProperty = DependencyProperty.Register(
        nameof(HighlightQuery),
        typeof(string),
        typeof(HighlightedTextBlock),
        new PropertyMetadata(string.Empty, OnHighlightChanged));

    public string HighlightText
    {
        get => (string)GetValue(HighlightTextProperty);
        set => SetValue(HighlightTextProperty, value);
    }

    public string HighlightQuery
    {
        get => (string)GetValue(HighlightQueryProperty);
        set => SetValue(HighlightQueryProperty, value);
    }

    private static void OnHighlightChanged(DependencyObject dependencyObject, DependencyPropertyChangedEventArgs _) =>
        ((HighlightedTextBlock)dependencyObject).RebuildInlines();

    private void RebuildInlines()
    {
        Inlines.Clear();
        var text = HighlightText ?? string.Empty;
        var terms = (HighlightQuery ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.CurrentCultureIgnoreCase)
            .OrderByDescending(term => term.Length)
            .ToArray();
        if (text.Length == 0 || terms.Length == 0)
        {
            Inlines.Add(new Run(text));
            return;
        }

        var position = 0;
        while (position < text.Length)
        {
            var nextMatch = terms
                .Select(term => (Term: term, Index: text.IndexOf(term, position, StringComparison.CurrentCultureIgnoreCase)))
                .Where(match => match.Index >= 0)
                .OrderBy(match => match.Index)
                .ThenByDescending(match => match.Term.Length)
                .FirstOrDefault();
            if (nextMatch.Term is null)
            {
                Inlines.Add(new Run(text[position..]));
                break;
            }

            if (nextMatch.Index > position)
            {
                Inlines.Add(new Run(text[position..nextMatch.Index]));
            }

            Inlines.Add(new Run(text.Substring(nextMatch.Index, nextMatch.Term.Length))
            {
                Background = new SolidColorBrush(Color.FromRgb(255, 214, 51)),
                Foreground = new SolidColorBrush(Color.FromRgb(24, 28, 34)),
                FontWeight = FontWeights.SemiBold,
            });
            position = nextMatch.Index + nextMatch.Term.Length;
        }
    }
}

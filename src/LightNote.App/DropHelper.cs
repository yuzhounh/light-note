using System.Windows;

namespace LightNote.App;

public enum DropIndicator
{
    None,
    Highlight,
    TopLine,
    BottomLine,
}

public static class DropHelper
{
    public static readonly DependencyProperty IndicatorProperty =
        DependencyProperty.RegisterAttached(
            "Indicator",
            typeof(DropIndicator),
            typeof(DropHelper),
            new FrameworkPropertyMetadata(DropIndicator.None, FrameworkPropertyMetadataOptions.AffectsRender));

    public static DropIndicator GetIndicator(DependencyObject obj) =>
        (DropIndicator)obj.GetValue(IndicatorProperty);

    public static void SetIndicator(DependencyObject obj, DropIndicator value) =>
        obj.SetValue(IndicatorProperty, value);
}

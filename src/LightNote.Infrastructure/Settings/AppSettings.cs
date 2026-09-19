namespace LightNote.Infrastructure.Settings;

public sealed record AppSettings
{
    public double WindowLeft { get; init; } = double.NaN;

    public double WindowTop { get; init; } = double.NaN;

    public double WindowWidth { get; init; } = 1180;

    public double WindowHeight { get; init; } = 760;

    public bool WindowMaximized { get; init; }

    public double NotebookPaneWidth { get; init; } = 220;

    public double NoteListPaneWidth { get; init; } = 300;

    public string Theme { get; init; } = "system";

    public bool MinimizeToTray { get; init; }

    public bool StartWithWindows { get; init; }

    public bool AutomaticBackups { get; init; } = true;

    public int BackupRetentionCount { get; init; } = 10;
}

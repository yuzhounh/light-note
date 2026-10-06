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

    public bool ShowRecentNavigation { get; init; }

    public bool ShowPinnedNavigation { get; init; }

    public bool ShowTrashNavigation { get; init; }

    public bool AutomaticBackups { get; init; } = true;

    public int BackupRetentionCount { get; init; } = 10;

    public bool CompressImages { get; init; } = true;

    public bool NoteSortByUpdated { get; init; }

    public bool NoteSortDescending { get; init; } = true;

    /// <summary>笔记卡片密度：compact（紧凑）、comfortable（舒适）、spacious（宽松）。</summary>
    public string NoteListDensity { get; init; } = "comfortable";

    public string LinkOpenMode { get; init; } = "internal";
}

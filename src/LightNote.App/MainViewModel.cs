using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;

namespace LightNote.App;

public sealed partial class MainViewModel(
    INoteRepository noteRepository,
    INotebookRepository notebookRepository,
    IAppLogger logger,
    IAttachmentService? attachmentService = null,
    ITagRepository? tagRepository = null,
    INoteHistoryRepository? historyRepository = null,
    IRecoveryService? recoveryService = null) : ObservableObject
{
    private const int NotePageSize = 50;
    private readonly Dictionary<string, Note> _knownNotes = [];
    private readonly Dictionary<string, PendingSave> _pendingSaves = [];
    private readonly SemaphoreSlim _saveGate = new(1, 1);
    private bool _suppressTitleChanges;
    private bool _isInitializing;
    private bool _showRecentNavigation;
    private bool _showPinnedNavigation;
    private bool _showTrashNavigation;
    private int _reloadGeneration;
    private int _tagLoadGeneration;
    private int? _notesTotalCount;
    private CancellationTokenSource? _searchCancellation;

    public event EventHandler? SelectedNoteChanged;

    public event EventHandler? NewNotebookRequested;

    public ObservableCollection<NotebookListItem> Notebooks { get; } = [];

    public ObservableCollection<NoteListItem> Notes { get; } = [];

    [ObservableProperty]
    private NotebookListItem? _selectedNotebook;

    [ObservableProperty]
    private NoteListItem? _selectedNote;

    [ObservableProperty]
    private string _editableTitle = string.Empty;

    [ObservableProperty]
    private string _editorStatus = "正在初始化本地笔记…";

    [ObservableProperty]
    private bool _hasUnsavedChanges;

    [ObservableProperty]
    private string _searchQuery = string.Empty;

    [ObservableProperty]
    private string _selectedTagsDisplay = string.Empty;

    [ObservableProperty]
    private string _syncStatus = "同步未配置";

    [ObservableProperty]
    private bool _hasMoreNotes;

    [ObservableProperty]
    private bool _isLoadingMore;

    public bool HasNotes => Notes.Count > 0;

    public bool IsEditorEnabled => SelectedNote is not null;

    public bool IsTrashSelected => SelectedNotebook?.Kind == NotebookKind.Trash;

    public bool IsSearchActive => !string.IsNullOrWhiteSpace(SearchQuery);

    public string NotesHeading
    {
        get
        {
            if (IsSearchActive)
            {
                return $"搜索“{SearchQuery.Trim()}”";
            }

            var name = SelectedNotebook?.Name ?? "最近笔记";
            return _notesTotalCount is int totalCount
                ? $"{name}（{totalCount}条）"
                : name;
        }
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        _isInitializing = true;
        await ReloadNotebooksAsync(cancellationToken: cancellationToken);
        SelectedNotebook = Notebooks.FirstOrDefault();
        _isInitializing = false;
        await ReloadNotesAsync(cancellationToken: cancellationToken);
    }

    public void ConfigureNavigation(bool showRecent, bool showPinned, bool showTrash)
    {
        _showRecentNavigation = showRecent;
        _showPinnedNavigation = showPinned;
        _showTrashNavigation = showTrash;
    }

    public async Task UpdateNavigationAsync(
        bool showRecent,
        bool showPinned,
        bool showTrash,
        CancellationToken cancellationToken = default)
    {
        ConfigureNavigation(showRecent, showPinned, showTrash);
        await ReloadNotebooksAsync(cancellationToken: cancellationToken);
        await ReloadNotesAsync(cancellationToken: cancellationToken);
    }

    public async Task CreateNotebookAsync(string name, CancellationToken cancellationToken = default)
    {
        var normalizedName = name.Trim();
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            return;
        }

        var existing = Notebooks.FirstOrDefault(item =>
            item.Kind == NotebookKind.User &&
            string.Equals(item.Name, normalizedName, StringComparison.CurrentCultureIgnoreCase));
        if (existing is not null)
        {
            SelectedNotebook = existing;
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var notebook = new Notebook
        {
            Id = Guid.NewGuid().ToString(),
            Name = normalizedName,
            SortOrder = Notebooks.Count(item => item.Kind == NotebookKind.User),
            CreatedAt = now,
            UpdatedAt = now,
        };
        await notebookRepository.UpsertAsync(notebook, cancellationToken);
        await ReloadNotebooksAsync(notebook.Id, cancellationToken);
        SelectedNotebook = Notebooks.First(item => item.Id == notebook.Id);
        EditorStatus = $"已创建笔记本“{notebook.Name}”";
    }

    public async Task CreateNotebookGroupAsync(string name, CancellationToken cancellationToken = default)
    {
        var normalizedName = name.Trim();
        if (string.IsNullOrWhiteSpace(normalizedName))
        {
            return;
        }

        var existing = Notebooks.FirstOrDefault(item =>
            item.Kind == NotebookKind.Group &&
            string.Equals(item.Name, normalizedName, StringComparison.CurrentCultureIgnoreCase));
        if (existing is not null)
        {
            SelectedNotebook = existing;
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var group = new NotebookGroup
        {
            Id = Guid.NewGuid().ToString(),
            Name = normalizedName,
            SortOrder = Notebooks.Count(item => item.Kind == NotebookKind.Group),
            CreatedAt = now,
            UpdatedAt = now,
        };
        await notebookRepository.UpsertGroupAsync(group, cancellationToken);
        await ReloadNotebooksAsync(group.Id, cancellationToken);
        SelectedNotebook = Notebooks.First(item => item.Id == group.Id && item.Kind == NotebookKind.Group);
        EditorStatus = $"已创建笔记本组“{group.Name}”";
    }

    public async Task RenameNotebookGroupAsync(
        string groupId,
        string name,
        CancellationToken cancellationToken = default)
    {
        var group = Notebooks.FirstOrDefault(item => item.Kind == NotebookKind.Group && item.Id == groupId);
        var normalizedName = name.Trim();
        if (group is null || string.IsNullOrWhiteSpace(normalizedName) || group.Name == normalizedName)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        await notebookRepository.UpsertGroupAsync(new NotebookGroup
        {
            Id = groupId,
            Name = normalizedName,
            SortOrder = group.SortOrder,
            CreatedAt = now,
            UpdatedAt = now,
        }, cancellationToken);
        await ReloadNotebooksAsync(groupId, cancellationToken);
        EditorStatus = $"笔记本组已重命名为“{normalizedName}”";
    }

    public async Task DeleteNotebookGroupAsync(
        string groupId,
        CancellationToken cancellationToken = default)
    {
        await notebookRepository.DeleteGroupAsync(groupId, cancellationToken);
        await ReloadNotebooksAsync(cancellationToken: cancellationToken);
        await ReloadNotesAsync(cancellationToken: cancellationToken);
        EditorStatus = "笔记本组已删除，组内笔记本仍保留";
    }

    public async Task AssignNotebookToGroupAsync(
        string notebookId,
        string? groupId,
        CancellationToken cancellationToken = default)
    {
        await notebookRepository.AssignToGroupAsync(notebookId, groupId, cancellationToken);
        await ReloadNotebooksAsync(notebookId, cancellationToken);
        EditorStatus = groupId is null ? "笔记本已移出分组" : "笔记本分组已更新";
    }

    public async Task ReorderNotebooksAsync(
        string sourceNotebookId,
        string targetNotebookId,
        bool insertAfter,
        CancellationToken cancellationToken = default)
    {
        if (sourceNotebookId == targetNotebookId)
        {
            return;
        }

        var notebooks = (await notebookRepository.ListAsync(cancellationToken)).ToList();
        var assignments = (await notebookRepository.ListGroupAssignmentsAsync(cancellationToken)).ToDictionary(k => k.Key, v => v.Value);

        var source = notebooks.FirstOrDefault(n => n.Id == sourceNotebookId);
        var target = notebooks.FirstOrDefault(n => n.Id == targetNotebookId);
        if (source is null || target is null)
        {
            return;
        }

        assignments.TryGetValue(sourceNotebookId, out var sourceGroupId);
        assignments.TryGetValue(targetNotebookId, out var targetGroupId);

        if (sourceGroupId != targetGroupId)
        {
            await notebookRepository.AssignToGroupAsync(sourceNotebookId, targetGroupId, cancellationToken);
            if (targetGroupId is null)
            {
                assignments.Remove(sourceNotebookId);
            }
            else
            {
                assignments[sourceNotebookId] = targetGroupId;
            }
        }

        var peers = notebooks
            .Where(n => assignments.TryGetValue(n.Id, out var g) ? g == targetGroupId : targetGroupId == null)
            .OrderBy(n => n.SortOrder)
            .ThenBy(n => n.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        peers.RemoveAll(n => n.Id == sourceNotebookId);
        var targetIndex = peers.FindIndex(n => n.Id == targetNotebookId);
        if (targetIndex < 0)
        {
            peers.Add(source);
        }
        else
        {
            var insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
            if (insertIndex > peers.Count) insertIndex = peers.Count;
            peers.Insert(insertIndex, source);
        }

        for (var i = 0; i < peers.Count; i++)
        {
            var item = peers[i];
            if (item.SortOrder != i)
            {
                var updated = item with { SortOrder = i, UpdatedAt = DateTimeOffset.UtcNow };
                await notebookRepository.UpsertAsync(updated, cancellationToken);
            }
        }

        await ReloadNotebooksAsync(sourceNotebookId, cancellationToken);
        EditorStatus = "笔记本排序已更新";
    }

    public async Task ReorderNotebookGroupsAsync(
        string sourceGroupId,
        string targetGroupId,
        bool insertAfter,
        CancellationToken cancellationToken = default)
    {
        if (sourceGroupId == targetGroupId)
        {
            return;
        }

        var groups = (await notebookRepository.ListGroupsAsync(cancellationToken)).ToList();
        var source = groups.FirstOrDefault(g => g.Id == sourceGroupId);
        var target = groups.FirstOrDefault(g => g.Id == targetGroupId);
        if (source is null || target is null)
        {
            return;
        }

        groups.RemoveAll(g => g.Id == sourceGroupId);
        var targetIndex = groups.FindIndex(g => g.Id == targetGroupId);
        if (targetIndex < 0)
        {
            groups.Add(source);
        }
        else
        {
            var insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
            if (insertIndex > groups.Count) insertIndex = groups.Count;
            groups.Insert(insertIndex, source);
        }

        for (var i = 0; i < groups.Count; i++)
        {
            var item = groups[i];
            if (item.SortOrder != i)
            {
                var updated = item with { SortOrder = i, UpdatedAt = DateTimeOffset.UtcNow };
                await notebookRepository.UpsertGroupAsync(updated, cancellationToken);
            }
        }

        await ReloadNotebooksAsync(sourceGroupId, cancellationToken);
        EditorStatus = "笔记本组排序已更新";
    }

    public async Task RefreshAfterSyncAsync(CancellationToken cancellationToken = default)
    {
        var selectedNotebookId = SelectedNotebook?.Id;
        var selectedNoteId = SelectedNote?.Model.Id;
        await ReloadNotebooksAsync(selectedNotebookId, cancellationToken);
        await ReloadNotesAsync(selectedNoteId, cancellationToken);
    }

    public async Task<IReadOnlyList<string>> GetSelectedTagNamesAsync(
        CancellationToken cancellationToken = default)
    {
        var noteId = SelectedNote?.Model.Id;
        if (noteId is null || tagRepository is null)
        {
            return [];
        }

        var tags = await tagRepository.ListForNoteAsync(noteId, cancellationToken);
        return tags.Select(tag => tag.Name).ToArray();
    }

    public async Task SetSelectedTagsAsync(
        string commaSeparatedNames,
        CancellationToken cancellationToken = default)
    {
        var noteId = SelectedNote?.Model.Id;
        if (noteId is null || tagRepository is null || IsTrashSelected)
        {
            return;
        }

        var names = commaSeparatedNames.Split(
            [',', '，', ';', '；'],
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        await tagRepository.SetForNoteAsync(noteId, names, cancellationToken);
        await LoadSelectedTagsAsync(noteId, cancellationToken);
        await ReloadNotebooksAsync(cancellationToken: cancellationToken);
        await ReloadNotesAsync(noteId, cancellationToken);
        EditorStatus = names.Length == 0 ? "已清除标签" : "标签已保存";
    }

    public async Task<IReadOnlyList<NoteVersion>> GetSelectedHistoryAsync(
        CancellationToken cancellationToken = default)
    {
        var noteId = SelectedNote?.Model.Id;
        return noteId is null || historyRepository is null
            ? []
            : await historyRepository.ListAsync(noteId, cancellationToken);
    }

    public async Task RestoreVersionAsync(
        string versionId,
        CancellationToken cancellationToken = default)
    {
        var noteId = SelectedNote?.Model.Id;
        if (noteId is null || historyRepository is null || IsTrashSelected)
        {
            return;
        }

        if (!await FlushAllAsync())
        {
            throw new InvalidOperationException("当前笔记尚未保存，无法恢复历史版本。");
        }

        var version = await historyRepository.GetAsync(versionId, cancellationToken);
        var current = await noteRepository.GetAsync(noteId, cancellationToken);
        if (version is null || current is null || version.NoteId != noteId)
        {
            throw new InvalidOperationException("所选历史版本已不存在。");
        }

        var restored = current with
        {
            Title = version.Title,
            BodyJson = version.BodyJson,
            BodyHtml = version.BodyHtml,
            BodyText = version.BodyText,
            UpdatedAt = DateTimeOffset.UtcNow,
            Version = current.Version + 1,
            SyncState = SyncState.Dirty,
        };
        await noteRepository.UpsertAsync(restored, cancellationToken);
        recoveryService?.ClearDraft(noteId);
        _knownNotes[noteId] = restored;
        await ReloadNotesAsync(noteId, cancellationToken);
        EditorStatus = $"已恢复到版本 {version.Version}";
    }

    public async Task MoveNoteAsync(
        string noteId,
        string? notebookId,
        CancellationToken cancellationToken = default)
    {
        if (IsTrashSelected)
        {
            return;
        }

        Note current;
        if (TryGetLatestNote(noteId, out var existing))
        {
            current = existing;
        }
        else
        {
            var fromRepo = await noteRepository.GetAsync(noteId, cancellationToken);
            if (fromRepo is null || fromRepo.DeletedAt is not null)
            {
                return;
            }
            current = fromRepo;
        }

        if (current.NotebookId == notebookId)
        {
            return;
        }

        QueueSave(current with
        {
            NotebookId = notebookId,
            UpdatedAt = DateTimeOffset.UtcNow,
            Version = current.Version + 1,
            SyncState = SyncState.Dirty,
        });
        CancelPendingDelay(noteId);
        await SavePendingAsync(noteId, cancellationToken: cancellationToken);
        await ReloadNotesAsync(noteId, cancellationToken: cancellationToken);
        var targetName = notebookId is null
            ? "未归档"
            : Notebooks.FirstOrDefault(item => item.Id == notebookId)?.Name ?? "目标笔记本";
        EditorStatus = $"笔记已移动到“{targetName}”";
    }

    public Task MoveSelectedNoteAsync(
        string? notebookId,
        CancellationToken cancellationToken = default)
    {
        var noteId = SelectedNote?.Model.Id;
        return noteId is null
            ? Task.CompletedTask
            : MoveNoteAsync(noteId, notebookId, cancellationToken);
    }

    public void ApplyEditorChange(
        string noteId,
        string bodyJson,
        string bodyHtml,
        string bodyText)
    {
        if (!TryGetLatestNote(noteId, out var current) || current.DeletedAt is not null)
        {
            return;
        }

        if (current.BodyJson == bodyJson && current.BodyHtml == bodyHtml && current.BodyText == bodyText)
        {
            return;
        }

        if (string.Equals(current.BodyText.Trim(), bodyText.Trim(), StringComparison.Ordinal))
        {
            try
            {
                using var currentDoc = JsonDocument.Parse(current.BodyJson);
                using var newDoc = JsonDocument.Parse(bodyJson);
                if (JsonElement.DeepEquals(currentDoc.RootElement, newDoc.RootElement))
                {
                    return;
                }
            }
            catch
            {
                // Fallback to strict comparison
            }
        }

        QueueSave(current with
        {
            BodyJson = bodyJson,
            BodyHtml = bodyHtml,
            BodyText = bodyText,
            UpdatedAt = DateTimeOffset.UtcNow,
            Version = current.Version + 1,
            SyncState = SyncState.Dirty,
        });
    }

    public void ApplyNoteTitleChange(string noteId, string value)
    {
        if (!TryGetLatestNote(noteId, out var current) || current.DeletedAt is not null)
        {
            return;
        }

        var normalizedTitle = string.IsNullOrWhiteSpace(value) ? "无标题笔记" : value.Trim();
        if (current.Title == normalizedTitle)
        {
            return;
        }

        QueueSave(current with
        {
            Title = normalizedTitle,
            UpdatedAt = DateTimeOffset.UtcNow,
            Version = current.Version + 1,
            SyncState = SyncState.Dirty,
        });
    }

    public async Task<bool> FlushAllAsync()
    {
        foreach (var pending in _pendingSaves.Values)
        {
            pending.DelayCancellation?.Cancel();
        }

        foreach (var noteId in _pendingSaves.Keys.ToArray())
        {
            await SavePendingAsync(noteId);
        }

        return !HasUnsavedChanges;
    }

    public async Task DeletePermanentlyAsync(CancellationToken cancellationToken = default)
    {
        var noteId = SelectedNote?.Model.Id;
        if (noteId is null || !IsTrashSelected)
        {
            return;
        }

        CancelPendingSave(noteId);
        await _saveGate.WaitAsync(cancellationToken);
        try
        {
            if (attachmentService is not null)
            {
                await attachmentService.DeleteForNoteAsync(noteId, cancellationToken);
            }

            await noteRepository.DeletePermanentlyAsync(noteId, cancellationToken);
            recoveryService?.ClearDraft(noteId);
            _pendingSaves.Remove(noteId);
            _knownNotes.Remove(noteId);
        }
        finally
        {
            _saveGate.Release();
        }

        await ReloadNotesAsync(cancellationToken: cancellationToken);
        EditorStatus = "笔记已永久删除";
        UpdateUnsavedState();
    }

    [RelayCommand]
    private async Task NewNoteAsync()
    {
        if (IsSearchActive)
        {
            SearchQuery = string.Empty;
        }

        if (SelectedNotebook?.Kind is NotebookKind.Trash or NotebookKind.Pinned)
        {
            SelectedNotebook = Notebooks.FirstOrDefault(item => item.Kind == NotebookKind.Recent)
                ?? Notebooks.FirstOrDefault(item => item.Kind == NotebookKind.All)
                ?? Notebooks.First();
        }

        var selectedTag = SelectedNotebook?.Kind == NotebookKind.Tag ? SelectedNotebook : null;
        var now = DateTimeOffset.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid().ToString(),
            NotebookId = SelectedNotebook?.Kind == NotebookKind.User ? SelectedNotebook.Id : null,
            Title = "无标题笔记",
            BodyJson = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
            BodyHtml = "<p></p>",
            BodyText = string.Empty,
            CreatedAt = now,
            UpdatedAt = now,
        };

        await noteRepository.UpsertAsync(note);
        if (selectedTag is not null && tagRepository is not null)
        {
            await tagRepository.SetForNoteAsync(note.Id, [selectedTag.Name]);
        }

        _knownNotes[note.Id] = note;
        await ReloadNotesAsync(note.Id);
        EditorStatus = "新笔记已创建并保存";
    }

    [RelayCommand]
    private void NewNotebook() => NewNotebookRequested?.Invoke(this, EventArgs.Empty);

    [RelayCommand]
    private async Task SaveAsync()
    {
        var noteId = SelectedNote?.Model.Id;
        if (noteId is null)
        {
            return;
        }

        CancelPendingDelay(noteId);
        await SavePendingAsync(noteId);
        if (!_pendingSaves.ContainsKey(noteId))
        {
            EditorStatus = $"已保存 · {DateTime.Now:HH:mm:ss}";
        }
    }

    [RelayCommand]
    private async Task LoadMoreAsync()
    {
        if (!HasMoreNotes || IsLoadingMore || SelectedNotebook is null)
        {
            return;
        }

        var generation = _reloadGeneration;
        var notebook = SelectedNotebook;
        IsLoadingMore = true;
        try
        {
            var page = await LoadNoteItemsAsync(
                notebook,
                Notes.Count,
                NotePageSize + 1,
                CancellationToken.None);
            if (generation != _reloadGeneration || SelectedNotebook != notebook)
            {
                return;
            }

            foreach (var item in page.Take(NotePageSize))
            {
                if (Notes.All(existing => existing.Model.Id != item.Model.Id))
                {
                    _knownNotes[item.Model.Id] = item.Model;
                    Notes.Add(item);
                }
            }

            HasMoreNotes = page.Count > NotePageSize;
            EditorStatus = HasMoreNotes
                ? $"已加载 {Notes.Count} 篇，仍有更多"
                : $"已加载全部 {Notes.Count} 篇";
        }
        catch (Exception exception)
        {
            logger.Error("Failed to load more notes.", exception);
            EditorStatus = "加载更多笔记失败，请查看日志";
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    [RelayCommand]
    private async Task TogglePinAsync()
    {
        if (SelectedNote is null || IsTrashSelected)
        {
            return;
        }

        var current = GetLatestNote(SelectedNote.Model.Id);
        QueueSave(current with
        {
            IsPinned = !current.IsPinned,
            UpdatedAt = DateTimeOffset.UtcNow,
            Version = current.Version + 1,
            SyncState = SyncState.Dirty,
        });
        await SaveAsync();
        SortNotes();
    }

    [RelayCommand]
    private async Task DeleteNoteAsync()
    {
        if (SelectedNote is null || IsTrashSelected)
        {
            return;
        }

        await SetDeletedStateAsync(SelectedNote.Model.Id, DateTimeOffset.UtcNow);
        await ReloadNotesAsync();
        EditorStatus = "笔记已移到回收站";
    }

    [RelayCommand]
    private async Task RestoreNoteAsync()
    {
        if (SelectedNote is null || !IsTrashSelected)
        {
            return;
        }

        await SetDeletedStateAsync(SelectedNote.Model.Id, null);
        await ReloadNotesAsync();
        EditorStatus = "笔记已恢复";
    }

    partial void OnSelectedNotebookChanged(NotebookListItem? value)
    {
        _notesTotalCount = null;
        OnPropertyChanged(nameof(IsTrashSelected));
        OnPropertyChanged(nameof(NotesHeading));
        if (!_isInitializing && value is not null)
        {
            if (IsSearchActive)
            {
                SearchQuery = string.Empty;
                return;
            }

            _ = ReloadNotesSafelyAsync();
        }
    }

    partial void OnSelectedNoteChanged(NoteListItem? value)
    {
        _suppressTitleChanges = true;
        EditableTitle = value?.Title ?? string.Empty;
        _suppressTitleChanges = false;
        OnPropertyChanged(nameof(IsEditorEnabled));
        SelectedNoteChanged?.Invoke(this, EventArgs.Empty);
        if (value is null)
        {
            SelectedTagsDisplay = string.Empty;
        }
        else
        {
            _ = LoadSelectedTagsSafelyAsync(value.Model.Id);
        }
    }

    partial void OnSearchQueryChanged(string value)
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = new CancellationTokenSource();
        _notesTotalCount = null;
        OnPropertyChanged(nameof(IsSearchActive));
        OnPropertyChanged(nameof(NotesHeading));
        _ = ReloadSearchDebouncedAsync(_searchCancellation.Token);
    }

    partial void OnEditableTitleChanged(string value)
    {
        if (_suppressTitleChanges || SelectedNote is null || IsTrashSelected)
        {
            return;
        }

        var current = GetLatestNote(SelectedNote.Model.Id);
        var normalizedTitle = string.IsNullOrWhiteSpace(value) ? "无标题笔记" : value.Trim();
        if (current.Title == normalizedTitle)
        {
            return;
        }

        QueueSave(current with
        {
            Title = normalizedTitle,
            UpdatedAt = DateTimeOffset.UtcNow,
            Version = current.Version + 1,
            SyncState = SyncState.Dirty,
        });
    }

    private async Task ReloadSearchDebouncedAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (IsSearchActive)
            {
                EditorStatus = "正在搜索…";
                await Task.Delay(TimeSpan.FromMilliseconds(250), cancellationToken);
            }

            await ReloadNotesAsync(cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            logger.Error("Failed to search notes.", exception);
            EditorStatus = "搜索失败，请查看日志";
        }
    }

    private async Task LoadSelectedTagsSafelyAsync(string noteId)
    {
        try
        {
            await LoadSelectedTagsAsync(noteId);
        }
        catch (Exception exception)
        {
            logger.Error($"Failed to load tags for note {noteId}.", exception);
        }
    }

    private async Task LoadSelectedTagsAsync(
        string noteId,
        CancellationToken cancellationToken = default)
    {
        if (tagRepository is null)
        {
            SelectedTagsDisplay = string.Empty;
            return;
        }

        var generation = Interlocked.Increment(ref _tagLoadGeneration);
        var tags = await tagRepository.ListForNoteAsync(noteId, cancellationToken);
        if (generation != _tagLoadGeneration || SelectedNote?.Model.Id != noteId)
        {
            return;
        }

        SelectedTagsDisplay = tags.Count == 0
            ? string.Empty
            : string.Join("  ", tags.Select(tag => $"#{tag.Name}"));
    }

    private async Task ReloadNotebooksAsync(
        string? preferredId = null,
        CancellationToken cancellationToken = default)
    {
        var notebooks = await notebookRepository.ListAsync(cancellationToken);
        var groups = await notebookRepository.ListGroupsAsync(cancellationToken);
        var groupAssignments = await notebookRepository.ListGroupAssignmentsAsync(cancellationToken);
        var tags = tagRepository is null
            ? []
            : await tagRepository.ListAsync(cancellationToken);
        var currentKind = SelectedNotebook?.Kind;
        var currentId = preferredId ?? SelectedNotebook?.Id;

        var wasInitializing = _isInitializing;
        _isInitializing = true;
        Notebooks.Clear();
        if (_showRecentNavigation)
        {
            Notebooks.Add(new NotebookListItem(null, "最近笔记", NotebookKind.Recent));
        }
        if (_showPinnedNavigation)
        {
            Notebooks.Add(new NotebookListItem(null, "置顶笔记", NotebookKind.Pinned));
        }
        Notebooks.Add(new NotebookListItem(null, "全部笔记", NotebookKind.All));
        Notebooks.Add(new NotebookListItem(null, "笔记本组", NotebookKind.GroupRoot));
        foreach (var group in groups)
        {
            Notebooks.Add(new NotebookListItem(
                group.Id,
                group.Name,
                NotebookKind.Group,
                SortOrder: group.SortOrder));
            foreach (var notebook in notebooks.Where(item =>
                         groupAssignments.TryGetValue(item.Id, out var groupId) && groupId == group.Id))
            {
                Notebooks.Add(new NotebookListItem(
                    notebook.Id,
                    notebook.Name,
                    NotebookKind.User,
                    group.Id,
                    notebook.SortOrder));
            }
        }
        foreach (var notebook in notebooks.Where(item => !groupAssignments.ContainsKey(item.Id)))
        {
            Notebooks.Add(new NotebookListItem(
                notebook.Id,
                notebook.Name,
                NotebookKind.User,
                SortOrder: notebook.SortOrder));
        }
        foreach (var tag in tags)
        {
            Notebooks.Add(new NotebookListItem(tag.Id, tag.Name, NotebookKind.Tag));
        }
        if (_showTrashNavigation)
        {
            Notebooks.Add(new NotebookListItem(null, "回收站", NotebookKind.Trash));
        }

        SelectedNotebook = Notebooks.FirstOrDefault(item =>
            item.Id == currentId && item.Kind is NotebookKind.User or NotebookKind.Tag or NotebookKind.Group)
            ?? Notebooks.FirstOrDefault(item => item.Kind == currentKind)
            ?? Notebooks[0];
        _isInitializing = wasInitializing;
    }

    private async Task ReloadNotesSafelyAsync()
    {
        try
        {
            await ReloadNotesAsync();
        }
        catch (Exception exception)
        {
            logger.Error("Failed to reload notes.", exception);
            EditorStatus = "无法加载笔记，请查看日志";
        }
    }

    private async Task ReloadNotesAsync(
        string? preferredNoteId = null,
        CancellationToken cancellationToken = default)
    {
        var notebook = SelectedNotebook;
        if (notebook is null)
        {
            HasMoreNotes = false;
            _notesTotalCount = null;
            OnPropertyChanged(nameof(NotesHeading));
            return;
        }

        var generation = Interlocked.Increment(ref _reloadGeneration);
        var totalCountTask = CountNotesForHeadingAsync(notebook, cancellationToken);
        var page = await LoadNoteItemsAsync(
            notebook,
            0,
            NotePageSize + 1,
            cancellationToken);
        var totalCount = await totalCountTask;
        var loadedItems = page.Take(NotePageSize).ToArray();
        var hasMore = page.Count > NotePageSize;
        if (generation != _reloadGeneration)
        {
            return;
        }

        var selectedId = preferredNoteId ?? SelectedNote?.Model.Id;
        Notes.Clear();
        foreach (var item in loadedItems)
        {
            _knownNotes[item.Model.Id] = item.Model;
            Notes.Add(item);
        }

        HasMoreNotes = hasMore;
        _notesTotalCount = totalCount;
        OnPropertyChanged(nameof(NotesHeading));
        SelectedNote = Notes.FirstOrDefault(item => item.Model.Id == selectedId) ?? Notes.FirstOrDefault();
        OnPropertyChanged(nameof(HasNotes));
        EditorStatus = Notes.Count == 0
            ? IsSearchActive ? "没有找到匹配的笔记" : "这里还没有笔记"
            : IsSearchActive
                ? HasMoreNotes ? $"显示前 {Notes.Count} 篇搜索结果" : $"找到 {Notes.Count} 篇笔记"
                : HasMoreNotes ? $"已加载 {Notes.Count} 篇，仍有更多" : "本地数据已就绪";
    }

    private async Task<IReadOnlyList<NoteListItem>> LoadNoteItemsAsync(
        NotebookListItem notebook,
        int offset,
        int limit,
        CancellationToken cancellationToken)
    {
        if (IsSearchActive)
        {
            var query = SearchQuery.Trim();
            var hits = await noteRepository.SearchAsync(
                query,
                limit,
                offset,
                cancellationToken);
            return hits.Select(hit =>
            {
                var note = _pendingSaves.TryGetValue(hit.Note.Id, out var pending)
                    ? pending.Note
                    : hit.Note;
                return new NoteListItem(note, hit.Snippet, query);
            }).ToArray();
        }

        IReadOnlyList<Note> notes = notebook.Kind switch
        {
            NotebookKind.Recent => await noteRepository.ListRecentAsync(
                limit, offset, cancellationToken),
            NotebookKind.Pinned => await noteRepository.ListPinnedAsync(
                limit, offset, cancellationToken),
            NotebookKind.Tag when notebook.Id is not null =>
                await noteRepository.ListByTagAsync(
                    notebook.Id, limit, offset, cancellationToken),
            NotebookKind.Group when notebook.Id is not null =>
                await noteRepository.ListByNotebookIdsAsync(
                    (await notebookRepository.ListGroupAssignmentsAsync(cancellationToken))
                        .Where(item => item.Value == notebook.Id)
                        .Select(item => item.Key)
                        .ToArray(),
                    limit,
                    offset,
                    cancellationToken),
            _ => await noteRepository.ListAsync(
                notebook.Kind == NotebookKind.User ? notebook.Id : null,
                notebook.Kind is NotebookKind.All or NotebookKind.GroupRoot or NotebookKind.Trash,
                notebook.Kind == NotebookKind.Trash,
                limit,
                offset,
                cancellationToken),
        };
        return notes.Select(storedNote =>
        {
            var note = _pendingSaves.TryGetValue(storedNote.Id, out var pending)
                ? pending.Note
                : storedNote;
            return new NoteListItem(note);
        }).ToArray();
    }

    private async Task<int?> CountNotesForHeadingAsync(
        NotebookListItem notebook,
        CancellationToken cancellationToken)
    {
        return notebook.Kind switch
        {
            NotebookKind.All or NotebookKind.GroupRoot =>
                await noteRepository.CountAsync(
                    null, allNotebooks: true, deletedOnly: false, cancellationToken: cancellationToken),
            NotebookKind.User when notebook.Id is not null =>
                await noteRepository.CountAsync(
                    notebook.Id, allNotebooks: false, deletedOnly: false, cancellationToken: cancellationToken),
            NotebookKind.Group when notebook.Id is not null =>
                await noteRepository.CountByNotebookIdsAsync(
                    (await notebookRepository.ListGroupAssignmentsAsync(cancellationToken))
                        .Where(item => item.Value == notebook.Id)
                        .Select(item => item.Key)
                        .ToArray(),
                    cancellationToken),
            _ => null,
        };
    }

    private async Task SetDeletedStateAsync(string noteId, DateTimeOffset? deletedAt)
    {
        var current = GetLatestNote(noteId);
        QueueSave(current with
        {
            DeletedAt = deletedAt,
            UpdatedAt = DateTimeOffset.UtcNow,
            Version = current.Version + 1,
            SyncState = SyncState.Dirty,
        });
        CancelPendingDelay(noteId);
        await SavePendingAsync(noteId);
    }

    private void QueueSave(Note note)
    {
        _knownNotes[note.Id] = note;
        Notes.FirstOrDefault(item => item.Model.Id == note.Id)?.Update(note);
        try
        {
            recoveryService?.SaveDraft(note);
        }
        catch (Exception exception)
        {
            logger.Error($"Failed to persist recovery draft for note {note.Id}.", exception);
        }

        if (!_pendingSaves.TryGetValue(note.Id, out var pending))
        {
            pending = new PendingSave(note);
            _pendingSaves[note.Id] = pending;
        }
        else
        {
            pending.Note = note;
            pending.Revision++;
            pending.IsDirty = true;
        }

        CancelPendingDelay(note.Id);
        pending.DelayCancellation = new CancellationTokenSource();
        var revision = pending.Revision;
        _ = DebounceSaveAsync(note.Id, revision, pending.DelayCancellation.Token);
        EditorStatus = "有未保存更改…";
        UpdateUnsavedState();
    }

    private async Task DebounceSaveAsync(string noteId, long revision, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMilliseconds(500), cancellationToken);
            await SavePendingAsync(noteId, revision, cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task SavePendingAsync(
        string noteId,
        long? expectedRevision = null,
        CancellationToken cancellationToken = default)
    {
        if (!_pendingSaves.TryGetValue(noteId, out var pending) ||
            !pending.IsDirty ||
            expectedRevision is not null && pending.Revision != expectedRevision)
        {
            return;
        }

        var snapshot = pending.Note;
        var snapshotRevision = pending.Revision;
        if (SelectedNote?.Model.Id == noteId)
        {
            EditorStatus = "正在保存…";
        }

        await _saveGate.WaitAsync(cancellationToken);
        try
        {
            await noteRepository.UpsertAsync(snapshot, cancellationToken);
            if (attachmentService is not null)
            {
                try
                {
                    await attachmentService.ReconcileReferencesAsync(
                        snapshot.Id,
                        snapshot.BodyHtml,
                        cancellationToken);
                }
                catch (Exception exception)
                {
                    logger.Error($"Failed to reconcile attachments for note {noteId}.", exception);
                }
            }

            _knownNotes[noteId] = snapshot;
            Notes.FirstOrDefault(item => item.Model.Id == noteId)?.Update(snapshot);

            if (_pendingSaves.TryGetValue(noteId, out var latest) && latest.Revision == snapshotRevision)
            {
                latest.IsDirty = false;
                latest.DelayCancellation?.Dispose();
                _pendingSaves.Remove(noteId);
                try
                {
                    recoveryService?.ClearDraft(noteId);
                }
                catch (Exception exception)
                {
                    logger.Error($"Failed to clear recovery draft for note {noteId}.", exception);
                }
                if (SelectedNote?.Model.Id == noteId)
                {
                    EditorStatus = $"已保存 · {DateTime.Now:HH:mm:ss}";
                }
            }

            SortNotes();
        }
        catch (Exception exception)
        {
            logger.Error($"Failed to save note {noteId}.", exception);
            if (SelectedNote?.Model.Id == noteId)
            {
                EditorStatus = "保存失败 · 内容仍保留在内存中";
            }
        }
        finally
        {
            _saveGate.Release();
            UpdateUnsavedState();
        }
    }

    private void SortNotes()
    {
        var sorted = Notes
            .OrderByDescending(item => item.Model.IsPinned)
            .ThenByDescending(item => item.Model.CreatedAt)
            .ToArray();
        for (var targetIndex = 0; targetIndex < sorted.Length; targetIndex++)
        {
            var currentIndex = Notes.IndexOf(sorted[targetIndex]);
            if (currentIndex != targetIndex)
            {
                Notes.Move(currentIndex, targetIndex);
            }
        }
    }

    private Note GetLatestNote(string noteId) =>
        TryGetLatestNote(noteId, out var note)
            ? note
            : throw new InvalidOperationException($"Note {noteId} is not loaded.");

    private bool TryGetLatestNote(string noteId, out Note note)
    {
        if (_pendingSaves.TryGetValue(noteId, out var pending))
        {
            note = pending.Note;
            return true;
        }

        return _knownNotes.TryGetValue(noteId, out note!);
    }

    private void CancelPendingDelay(string noteId)
    {
        if (_pendingSaves.TryGetValue(noteId, out var pending))
        {
            pending.DelayCancellation?.Cancel();
            pending.DelayCancellation?.Dispose();
            pending.DelayCancellation = null;
        }
    }

    private void CancelPendingSave(string noteId)
    {
        CancelPendingDelay(noteId);
        _pendingSaves.Remove(noteId);
        UpdateUnsavedState();
    }

    private void UpdateUnsavedState() =>
        HasUnsavedChanges = _pendingSaves.Values.Any(pending => pending.IsDirty);

    private sealed class PendingSave(Note note)
    {
        public Note Note { get; set; } = note;

        public long Revision { get; set; } = 1;

        public bool IsDirty { get; set; } = true;

        public CancellationTokenSource? DelayCancellation { get; set; }
    }
}

public sealed class NoteListItem(
    Note note,
    string? previewOverride = null,
    string matchQuery = "") : ObservableObject
{
    private readonly string? _previewOverride = previewOverride;

    public Note Model { get; private set; } = note;

    public string Title => Model.Title;

    public string TitleDisplay => Model.IsPinned ? $"★ {Model.Title}" : Model.Title;

    public string Preview => NormalizePreview(_previewOverride ?? Model.BodyText);

    public string MatchQuery { get; } = matchQuery;

    public string UpdatedLabel => Model.UpdatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm");

    public bool IsUnsynced => Model.SyncState == SyncState.Dirty;

    private static string NormalizePreview(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return "空笔记";
        }

        return string.Join(' ', text.Split(
            (char[]?)null,
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
    }

    public void Update(Note updatedNote)
    {
        Model = updatedNote;
        OnPropertyChanged(nameof(Model));
        OnPropertyChanged(nameof(Title));
        OnPropertyChanged(nameof(TitleDisplay));
        OnPropertyChanged(nameof(Preview));
        OnPropertyChanged(nameof(UpdatedLabel));
        OnPropertyChanged(nameof(IsUnsynced));
    }
}

public sealed record NotebookListItem(
    string? Id,
    string Name,
    NotebookKind Kind,
    string? GroupId = null,
    int SortOrder = 0)
{
    public string DisplayName => Name;

    public double Indent => Kind switch
    {
        NotebookKind.Group => 14,
        NotebookKind.User when GroupId is not null => 32,
        NotebookKind.User => 14,
        _ => 0,
    };

    public System.Windows.Thickness IndentMargin => new(Indent, 0, 0, 0);

    public string IconData => Kind switch
    {
        NotebookKind.Recent => "M10,2 A8,8 0 1 0 18,10 M10,5 V10 L14,12",
        NotebookKind.Pinned => "M10,2 L12.3,7 L18,7.7 L13.8,11.5 L15,17 L10,14 L5,17 L6.2,11.5 L2,7.7 L7.7,7 Z",
        NotebookKind.All => "M4,2 H16 V18 H4 Z M7,6 H13 M7,10 H13 M7,14 H13",
        NotebookKind.GroupRoot => "M2,5 H8 L10,7 H18 V17 H2 Z M4,3 H9 L11,5",
        NotebookKind.Group => "M2,6 H8 L10,8 H18 V17 H2 Z",
        NotebookKind.Unfiled => "M4,3 H16 V17 H4 Z",
        NotebookKind.User => "M4,3 H14 A2,2 0 0 1 16,5 V17 H6 A2,2 0 0 1 4,15 Z M7,3 V17",
        NotebookKind.Tag => "M3,4 H11 L17,10 L11,16 H3 Z M7,8 A1,1 0 1 0 7.1,8",
        NotebookKind.Trash => "M5,6 H15 M7,6 V17 H13 V6 M8,3 H12 L13,6 H7 Z M9,9 V14 M11,9 V14",
        _ => "M4,3 H16 V17 H4 Z",
    };
}

public enum NotebookKind
{
    Recent,
    Pinned,
    All,
    GroupRoot,
    Group,
    Unfiled,
    User,
    Tag,
    Trash,
}

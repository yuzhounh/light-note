namespace LightNote.Core.Models;

/// <summary>笔记列表排序：按创建时间或修改时间，是否逆序（新到旧）。置顶笔记始终排在最前。</summary>
public sealed record NoteSortOrder(bool ByUpdated = false, bool Descending = true);

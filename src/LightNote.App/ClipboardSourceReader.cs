using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace LightNote.App;

/// <summary>粘贴内容的来源：网页链接、文档名，或复制时所在的软件名。</summary>
/// <param name="Label">显示文字，例如 example.com、报告.docx 或 Word。</param>
/// <param name="Url">来源网页地址；只有从浏览器复制时才有。</param>
public sealed record ClipboardSource(string Label, string? Url);

/// <summary>
/// 读取系统剪贴板，判断刚复制的内容来自哪里：
/// 优先取 CF_HTML 头部的 SourceURL（网页显示域名，本地文档显示文件名）；
/// 再取剪贴板所有者窗口标题里的文档名；最后退而取剪贴板所有者软件名。
/// </summary>
public static class ClipboardSourceReader
{
    private static readonly Regex SourceUrlLine = new(
        @"^SourceURL:(?<url>.+?)\s*$",
        RegexOptions.Multiline | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Dictionary<string, string> FriendlyNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["WINWORD"] = "Word",
        ["EXCEL"] = "Excel",
        ["POWERPNT"] = "PowerPoint",
        ["OUTLOOK"] = "Outlook",
        ["ONENOTE"] = "OneNote",
        ["chrome"] = "Chrome",
        ["msedge"] = "Edge",
        ["firefox"] = "Firefox",
        ["wps"] = "WPS",
        ["et"] = "WPS 表格",
        ["wpp"] = "WPS 演示",
        ["Acrobat"] = "Adobe Acrobat",
        ["AcroRd32"] = "Adobe Reader",
        ["SumatraPDF"] = "SumatraPDF",
        ["Code"] = "VS Code",
        ["notepad"] = "记事本",
        ["WeChat"] = "微信",
        ["Weixin"] = "微信",
        ["TIM"] = "TIM",
        ["QQ"] = "QQ",
    };

    /// <summary>窗口标题末尾常见的“ - 软件名”后缀；用于从标题里剥出文档名。</summary>
    private static readonly string[] TitleSuffixes =
    {
        "Word", "PowerPoint", "Excel", "Outlook", "OneNote",
        "Microsoft Word", "Microsoft PowerPoint", "Microsoft Excel",
        "Adobe Acrobat", "Adobe Acrobat Reader", "Adobe Acrobat Reader DC", "Adobe Acrobat Pro", "Adobe Reader",
        "SumatraPDF",
        "WPS", "WPS 文字", "WPS 表格", "WPS 演示",
        "记事本", "Notepad", "Notepad++",
        "Google Chrome", "Chrome", "Microsoft Edge", "Edge", "Mozilla Firefox", "Firefox",
        "微信", "WeChat", "QQ", "TIM",
        "Visual Studio Code", "VS Code",
    };

    /// <summary>从 CF_HTML 的头部取出 SourceURL；接受 http、https 和 file。</summary>
    public static Uri? ParseSourceUri(string? cfHtml)
    {
        if (string.IsNullOrEmpty(cfHtml))
        {
            return null;
        }

        var match = SourceUrlLine.Match(cfHtml);
        if (!match.Success)
        {
            return null;
        }

        var value = match.Groups["url"].Value.Trim();
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               uri.Scheme is "http" or "https" or "file"
            ? uri
            : null;
    }

    /// <summary>从 CF_HTML 的头部取出网页 SourceURL；只接受 http 和 https。</summary>
    public static string? ParseSourceUrl(string? cfHtml)
    {
        var uri = ParseSourceUri(cfHtml);
        return uri is not null && uri.Scheme is "http" or "https" ? uri.AbsoluteUri : null;
    }

    /// <summary>网址的显示名：去掉 www. 的主机名。</summary>
    public static string LabelForUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri)
            ? (uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? uri.Host[4..] : uri.Host)
            : url;

    /// <summary>本地文档 SourceURL 的显示名：取文件名；网页临时文件不算文档。</summary>
    public static string? DocumentNameForFileUri(Uri uri)
    {
        if (!uri.IsFile)
        {
            return null;
        }

        var path = uri.LocalPath;
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        var fileName = System.IO.Path.GetFileName(path);
        if (string.IsNullOrWhiteSpace(fileName))
        {
            return null;
        }

        var extension = System.IO.Path.GetExtension(fileName);
        // 一些软件把标题/来源写成中间 HTML 临时文件，那不是用户眼里的文档。
        if (extension.Equals(".htm", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".html", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".tmp", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".url", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(@"\Temp\", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(@"\Temporary Internet Files\", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return fileName;
    }

    public static string FriendlyProcessName(string processName, string? fileDescription)
    {
        var name = FriendlyNames.TryGetValue(processName, out var friendly)
            ? friendly
            : !string.IsNullOrWhiteSpace(fileDescription) ? fileDescription.Trim() : processName;
        // Only application labels pass here; keep document suffixes and URL labels intact.
        return name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? name[..^4] : name;
    }

    /// <summary>把窗口标题去掉“ - 软件名”后缀，得到文档名；无法判断时返回 null。</summary>
    public static string? DocumentNameFromTitle(string? title, string? appLabel = null)
    {
        if (string.IsNullOrWhiteSpace(title))
        {
            return null;
        }

        // 有的软件用 en/em dash 分隔标题与软件名，先归一化。
        var text = title.Trim().Replace('\u2013', '-').Replace('\u2014', '-');

        var candidates = new List<string>();
        if (!string.IsNullOrWhiteSpace(appLabel))
        {
            candidates.Add(appLabel.Trim());
        }

        candidates.AddRange(TitleSuffixes);

        foreach (var candidate in candidates)
        {
            if (candidate.Length == 0)
            {
                continue;
            }

            var marker = " - " + candidate;
            if (text.Length > marker.Length &&
                text.EndsWith(marker, StringComparison.OrdinalIgnoreCase))
            {
                var name = text[..^marker.Length].Trim();
                if (!string.IsNullOrWhiteSpace(name))
                {
                    return name;
                }
            }
        }

        return null;
    }

    /// <summary>必须在 UI 线程调用。读不到来源时返回 null。</summary>
    public static ClipboardSource? TryRead()
    {
        try
        {
            var uri = ParseSourceUri(ReadHtmlFormat());
            if (uri is not null)
            {
                if (uri.Scheme is "http" or "https")
                {
                    return new ClipboardSource(LabelForUrl(uri.AbsoluteUri), uri.AbsoluteUri);
                }

                var fileName = DocumentNameForFileUri(uri);
                if (fileName is not null)
                {
                    return new ClipboardSource(fileName, null);
                }
            }

            var owner = ReadOwnerInfo();
            if (owner is null)
            {
                return null;
            }

            var title = ReadWindowTitle(owner.Window) ?? ReadWindowTitle(owner.MainWindowHandle);
            var documentName = DocumentNameFromTitle(title, owner.AppLabel);
            return new ClipboardSource(documentName ?? owner.AppLabel, null);
        }
        catch
        {
            // 剪贴板被其他程序占用、进程已退出等情况：不记录来源即可。
            return null;
        }
    }

    /// <summary>
    /// 在专用 STA 线程后台读取来源，带超时。
    /// 截图工具等会对剪贴板做延迟渲染，在 UI 线程直接读会把整个界面卡到对方进程响应为止；
    /// 超时后放弃本次读取（后台线程随后自行结束），返回 null。
    /// </summary>
    public static Task<ClipboardSource?> TryReadInBackgroundAsync(TimeSpan timeout)
    {
        var completion = new TaskCompletionSource<ClipboardSource?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            ClipboardSource? source = null;
            try
            {
                source = TryRead();
            }
            catch
            {
                // 读不到来源即可，不能影响粘贴。
            }

            completion.TrySetResult(source);
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.IsBackground = true;
        thread.Start();
        _ = Task.Delay(timeout).ContinueWith(
            _ => completion.TrySetResult(null),
            TaskScheduler.Default);
        return completion.Task;
    }

    private static string? ReadHtmlFormat()
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                return System.Windows.Clipboard.ContainsData("HTML Format")
                    ? System.Windows.Clipboard.GetData("HTML Format") as string
                    : null;
            }
            catch (COMException)
            {
                Thread.Sleep(20);
            }
        }

        return null;
    }

    private sealed record OwnerInfo(IntPtr Window, IntPtr MainWindowHandle, string AppLabel);

    private static OwnerInfo? ReadOwnerInfo()
    {
        var owner = GetClipboardOwner();
        if (owner == IntPtr.Zero)
        {
            return null;
        }

        GetWindowThreadProcessId(owner, out var processId);
        if (processId == 0 || processId == Environment.ProcessId)
        {
            return null;
        }

        using var process = Process.GetProcessById((int)processId);
        // 本软件内部的 WebView2 复制不算外部来源。
        if (process.ProcessName.StartsWith("msedgewebview2", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        string? description = null;
        try
        {
            description = process.MainModule?.FileVersionInfo.FileDescription;
        }
        catch
        {
            // 无权读取其他进程的模块信息时，用进程名。
        }

        var name = FriendlyProcessName(process.ProcessName, description);
        IntPtr mainWindow = IntPtr.Zero;
        try
        {
            // 有的软件（如 Chrome）用隐藏窗口持有剪贴板，标题要退回主窗口取。
            mainWindow = process.MainWindowHandle;
        }
        catch
        {
            // 进程已退出或无权访问时没有主窗口。
        }

        // 剪贴板所有者常常是子窗口或隐藏窗口，标题要取顶层窗口。
        return new OwnerInfo(GetAncestor(owner, GA_ROOT), mainWindow, name);
    }

    private static string? ReadWindowTitle(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            var length = GetWindowTextLength(hwnd);
            if (length <= 0)
            {
                return null;
            }

            var buffer = new System.Text.StringBuilder(length + 1);
            return GetWindowText(hwnd, buffer, buffer.Capacity) > 0 ? buffer.ToString() : null;
        }
        catch
        {
            return null;
        }
    }

    private const uint GA_ROOT = 2;

    [DllImport("user32.dll")]
    private static extern IntPtr GetClipboardOwner();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
}

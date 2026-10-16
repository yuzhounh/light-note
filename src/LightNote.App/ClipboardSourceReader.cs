using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace LightNote.App;

/// <summary>粘贴内容的来源：网页链接，或复制时所在的软件名。</summary>
/// <param name="Label">显示文字，例如 example.com 或 Word。</param>
/// <param name="Url">来源网页地址；只有从浏览器复制时才有。</param>
public sealed record ClipboardSource(string Label, string? Url);

/// <summary>
/// 读取系统剪贴板，判断刚复制的内容来自哪里：
/// 浏览器复制的 HTML 带有 SourceURL；其他情况退而求其次，取剪贴板所有者进程的软件名。
/// </summary>
public static class ClipboardSourceReader
{
    private static readonly Regex SourceUrlLine = new(
        @"^SourceURL:(?<url>\S+)\s*$",
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

    /// <summary>从 CF_HTML 的头部取出 SourceURL；只接受 http 和 https。</summary>
    public static string? ParseSourceUrl(string? cfHtml)
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

        return Uri.TryCreate(match.Groups["url"].Value, UriKind.Absolute, out var uri) &&
               uri.Scheme is "http" or "https"
            ? uri.AbsoluteUri
            : null;
    }

    /// <summary>网址的显示名：去掉 www. 的主机名。</summary>
    public static string LabelForUrl(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri)
            ? (uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? uri.Host[4..] : uri.Host)
            : url;

    public static string FriendlyProcessName(string processName, string? fileDescription)
    {
        var name = FriendlyNames.TryGetValue(processName, out var friendly)
            ? friendly
            : !string.IsNullOrWhiteSpace(fileDescription) ? fileDescription.Trim() : processName;
        // Only application labels pass here; keep document suffixes and URL labels intact.
        return name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? name[..^4] : name;
    }

    /// <summary>必须在 UI 线程调用。读不到来源时返回 null。</summary>
    public static ClipboardSource? TryRead()
    {
        try
        {
            var url = ParseSourceUrl(ReadHtmlFormat());
            if (url is not null)
            {
                return new ClipboardSource(LabelForUrl(url), url);
            }

            var app = ReadOwnerApplication();
            return app is null ? null : new ClipboardSource(app, null);
        }
        catch
        {
            // 剪贴板被其他程序占用、进程已退出等情况：不记录来源即可。
            return null;
        }
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

    private static string? ReadOwnerApplication()
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
        // 本软件内部的 WebView2 复制不算外部来源。
        return process.ProcessName.StartsWith("msedgewebview2", StringComparison.OrdinalIgnoreCase) ? null : name;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetClipboardOwner();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}

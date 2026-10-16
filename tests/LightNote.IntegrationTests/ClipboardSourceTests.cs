using LightNote.App;

namespace LightNote.IntegrationTests;

public sealed class ClipboardSourceTests
{
    private const string BrowserHtml =
        "Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000000200\r\nStartFragment:0000000141\r\nEndFragment:0000000164\r\n" +
        "SourceURL:https://www.example.com/articles/42?x=1\r\n<html><body><!--StartFragment-->hi<!--EndFragment--></body></html>";

    [Fact]
    public void BrowserHtmlYieldsSourceUrlAndHostLabel()
    {
        var url = ClipboardSourceReader.ParseSourceUrl(BrowserHtml);
        Assert.Equal("https://www.example.com/articles/42?x=1", url);
        Assert.Equal("example.com", ClipboardSourceReader.LabelForUrl(url!));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Version:0.9\r\nStartHTML:0000000105\r\n<html></html>")]
    [InlineData("Version:0.9\r\nSourceURL:file:///C:/notes/a.html\r\n<html></html>")]
    [InlineData("Version:0.9\r\nSourceURL:about:blank\r\n<html></html>")]
    public void MissingOrNonWebSourceUrlIsIgnored(string? html) =>
        Assert.Null(ClipboardSourceReader.ParseSourceUrl(html));

    [Theory]
    [InlineData("WINWORD", "Microsoft Word", "Word")]
    [InlineData("chrome", "Google Chrome", "Chrome")]
    [InlineData("SomeTool", "Some Tool Pro", "Some Tool Pro")]
    [InlineData("SomeTool", null, "SomeTool")]
    [InlineData("SnippingTool", "SnippingTool.exe", "SnippingTool")]
    [InlineData("SnippingTool", " SnippingTool.EXE ", "SnippingTool")]
    [InlineData("SomeTool.exe", null, "SomeTool")]
    [InlineData("SomeTool", "Paint.NET", "Paint.NET")]
    [InlineData("SomeTool", "研究方案.docx", "研究方案.docx")]
    [InlineData("SomeTool", "论文.pdf", "论文.pdf")]
    [InlineData("SomeTool", "report.exe.docx", "report.exe.docx")]
    [InlineData("SomeTool", "example.com", "example.com")]
    [InlineData("SomeTool", "script.ps1", "script.ps1")]
    [InlineData("SomeTool", "tool.exe helper", "tool.exe helper")]
    public void ProcessNamesAreMadeReadable(string process, string? description, string expected) =>
        Assert.Equal(expected, ClipboardSourceReader.FriendlyProcessName(process, description));
}

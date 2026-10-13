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
    public void ProcessNamesAreMadeReadable(string process, string? description, string expected) =>
        Assert.Equal(expected, ClipboardSourceReader.FriendlyProcessName(process, description));
}

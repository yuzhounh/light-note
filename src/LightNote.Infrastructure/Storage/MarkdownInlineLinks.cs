using System.Text.RegularExpressions;

namespace LightNote.Infrastructure.Storage;

public static class MarkdownInlineLinks
{
    public const string Expression = """(?<link>(?<![!\\])\[(?<label>[^\]\r\n]+)\]\((?<href>(?:https?://|mailto:)(?:[^()\s]|\([^()\s]*\))+)\))""";

    public static Regex Pattern { get; } = new(Expression,
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
}

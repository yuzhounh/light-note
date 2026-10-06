using System.Text;

namespace LightNote.App;

/// <summary>笔记详情（字数、创建与编辑时间）的文本生成。</summary>
public static class NoteInfoFormatter
{
    /// <summary>中日韩文字每个字算一个，连续的字母或数字算一个词，标点与空白不计。</summary>
    public static int CountWords(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return 0;
        }

        var count = 0;
        var inWord = false;
        foreach (var rune in text.EnumerateRunes())
        {
            if (IsCjk(rune.Value))
            {
                count++;
                inWord = false;
            }
            else if (Rune.IsLetterOrDigit(rune))
            {
                if (!inWord)
                {
                    count++;
                    inWord = true;
                }
            }
            else
            {
                inWord = false;
            }
        }

        return count;
    }

    public static string Format(string? bodyText, DateTimeOffset createdAt, DateTimeOffset updatedAt) =>
        $"字数统计：{CountWords(bodyText)}\n" +
        $"创建于 {createdAt.ToLocalTime():yyyy-MM-dd HH:mm}\n" +
        $"编辑于 {updatedAt.ToLocalTime():yyyy-MM-dd HH:mm}";

    private static bool IsCjk(int codePoint) =>
        codePoint is >= 0x3400 and <= 0x4DBF
            or >= 0x4E00 and <= 0x9FFF
            or >= 0xF900 and <= 0xFAFF
            or >= 0x3040 and <= 0x30FF
            or >= 0xAC00 and <= 0xD7AF
            or >= 0x20000 and <= 0x2FA1F;
}

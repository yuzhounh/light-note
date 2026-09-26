using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using LightNote.Infrastructure.Storage;

namespace LightNote.Infrastructure.Sync;

internal sealed record FirebaseSession
{
    public required string UserId { get; init; }

    public required string Email { get; init; }

    public string? DisplayName { get; init; }

    public string? PhotoUrl { get; init; }

    public required string IdToken { get; init; }

    public required string RefreshToken { get; init; }

    public required DateTimeOffset ExpiresAt { get; init; }
}

internal sealed class FirebaseSessionStore(AppDataPaths paths)
{
    private static readonly byte[] Entropy = "LightNote.Firebase.Session.v1"u8.ToArray();

    public FirebaseSession? Load()
    {
        if (!File.Exists(paths.FirebaseSessionPath))
        {
            return null;
        }

        var protectedBytes = File.ReadAllBytes(paths.FirebaseSessionPath);
        var json = Unprotect(protectedBytes);
        return JsonSerializer.Deserialize<FirebaseSession>(json);
    }

    public void Save(FirebaseSession session)
    {
        paths.EnsureCreated();
        var protectedBytes = Protect(JsonSerializer.SerializeToUtf8Bytes(session));
        var temporaryPath = $"{paths.FirebaseSessionPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllBytes(temporaryPath, protectedBytes);
            File.Move(temporaryPath, paths.FirebaseSessionPath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    public void Clear()
    {
        if (File.Exists(paths.FirebaseSessionPath))
        {
            File.Delete(paths.FirebaseSessionPath);
        }
    }

    private static byte[] Protect(byte[] data) => Transform(data, protect: true);

    private static byte[] Unprotect(byte[] data) => Transform(data, protect: false);

    private static byte[] Transform(byte[] data, bool protect)
    {
        var input = CreateBlob(data);
        var entropy = CreateBlob(Entropy);
        try
        {
            var succeeded = protect
                ? CryptProtectData(ref input, "LightNote Firebase session", ref entropy,
                    IntPtr.Zero, IntPtr.Zero, 0x1, out var output)
                : CryptUnprotectData(ref input, IntPtr.Zero, ref entropy,
                    IntPtr.Zero, IntPtr.Zero, 0x1, out output);
            if (!succeeded)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            try
            {
                var result = new byte[output.Size];
                Marshal.Copy(output.Data, result, 0, output.Size);
                return result;
            }
            finally
            {
                _ = LocalFree(output.Data);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(input.Data);
            Marshal.FreeHGlobal(entropy.Data);
        }
    }

    private static DataBlob CreateBlob(byte[] data)
    {
        var pointer = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, pointer, data.Length);
        return new DataBlob { Size = data.Length, Data = pointer };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int Size;
        public IntPtr Data;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(
        ref DataBlob input,
        string description,
        ref DataBlob entropy,
        IntPtr reserved,
        IntPtr prompt,
        int flags,
        out DataBlob output);

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(
        ref DataBlob input,
        IntPtr description,
        ref DataBlob entropy,
        IntPtr reserved,
        IntPtr prompt,
        int flags,
        out DataBlob output);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}

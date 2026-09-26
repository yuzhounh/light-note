using System.Net;
using System.Text;
using System.Text.Json;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;
using LightNote.Infrastructure.Sync;

namespace LightNote.IntegrationTests;

public sealed class FirebaseSyncTests : IDisposable
{
    private readonly string _testDirectory = Path.Combine(
        Path.GetTempPath(),
        "LightNote.Firebase.Tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task SignInAndSyncUploadOutboxIdempotently()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var now = DateTimeOffset.UtcNow;
        var notebook = new Notebook
        {
            Id = Guid.NewGuid().ToString(),
            Name = "Cloud",
            SortOrder = 0,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await new SqliteNotebookRepository(factory).UpsertAsync(notebook);
        var note = CreateNote("Sync me", "offline body") with { NotebookId = notebook.Id };
        await notes.UpsertAsync(note);
        await new SqliteTagRepository(factory).SetForNoteAsync(note.Id, ["sync", "local"]);
        await new AttachmentService(paths, factory).ImportAsync(
            note.Id,
            "pixel.png",
            "image/png",
            OnePixelPng);

        var handler = new RecordingFirebaseHandler();
        var service = new FirebaseSyncService(
            paths,
            factory,
            new HttpClient(handler),
            new NullLogger());
        var account = await service.SignInAsync("test@example.com", "password123");
        var first = await service.SyncAsync();
        var second = await service.SyncAsync();

        Assert.Equal("user-1", account.UserId);
        Assert.Equal(3, first.Uploaded);
        Assert.Equal(0, second.Uploaded);
        Assert.Equal(3, handler.PatchedDocuments.Count);
        Assert.Single(handler.StorageUploads);
        Assert.DoesNotContain(
            "test-id-token",
            Encoding.UTF8.GetString(await File.ReadAllBytesAsync(paths.FirebaseSessionPath)),
            StringComparison.Ordinal);
        Assert.Equal(SyncState.Clean, (await notes.GetAsync(note.Id))?.SyncState);
    }

    [Fact]
    public async Task NewerRemoteNotePreservesDirtyLocalVersionAsConflict()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var local = CreateNote("Local title", "local body");
        await notes.UpsertAsync(local);
        var remoteUpdatedAt = local.UpdatedAt.AddMinutes(5);
        var handler = new RecordingFirebaseHandler
        {
            RemoteNoteResponse = BuildRemoteNote(local.Id, remoteUpdatedAt),
        };
        var service = new FirebaseSyncService(
            paths,
            factory,
            new HttpClient(handler),
            new NullLogger());
        await service.SignInAsync("test@example.com", "password123");

        var result = await service.SyncAsync();
        var stored = await notes.GetAsync(local.Id);
        var history = await new SqliteNoteHistoryRepository(factory).ListAsync(local.Id);

        Assert.Equal(1, result.Downloaded);
        Assert.Equal(1, result.Conflicts);
        Assert.Equal("Remote title", stored?.Title);
        Assert.Equal("remote body", stored?.BodyText);
        Assert.Contains(history, version => version.IsConflict && version.Title == "Local title");
    }

    [Fact]
    public async Task SyncSucceedsWhenCloudStorageBucketNotFound()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Storage offline note", "content");
        await notes.UpsertAsync(note);
        await new AttachmentService(paths, factory).ImportAsync(
            note.Id,
            "test.png",
            "image/png",
            OnePixelPng);

        var handler = new RecordingFirebaseHandler
        {
            StorageShouldReturnNotFound = true,
        };
        var service = new FirebaseSyncService(
            paths,
            factory,
            new HttpClient(handler),
            new NullLogger());
        await service.SignInAsync("test@example.com", "password123");

        var result = await service.SyncAsync();
        Assert.Equal(2, result.Uploaded); // 1 note + 1 attachment metadata in firestore
        Assert.Empty(handler.StorageUploads);
    }

    [Fact]
    public async Task SignInWithGoogleSavesSessionAndReturnsAccount()
    {
        var (paths, factory, _) = await CreateServicesAsync();
        var handler = new RecordingFirebaseHandler();
        var service = new FirebaseSyncService(
            paths,
            factory,
            new HttpClient(handler),
            new NullLogger());

        var account = await service.SignInWithGoogleAsync(
            clientId: "test-client-id.apps.googleusercontent.com",
            clientSecret: "test-secret",
            openBrowserUrl: url =>
            {
                Task.Run(async () =>
                {
                    await Task.Delay(50);
                    var uri = new Uri(url);
                    var redirectUri = System.Web.HttpUtility.ParseQueryString(uri.Query)["redirect_uri"]!;
                    var state = System.Web.HttpUtility.ParseQueryString(uri.Query)["state"]!;
                    using var client = new HttpClient();
                    await client.GetAsync($"{redirectUri}?code=google-auth-code&state={state}");
                });
            });

        Assert.Equal("user-google-1", account.UserId);
        Assert.Equal("user@gmail.com", account.Email);
        Assert.Equal(account, service.CurrentAccount);
        Assert.Equal("test-client-id.apps.googleusercontent.com", service.GoogleClientId);
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, recursive: true);
        }
    }

    private async Task<(AppDataPaths Paths, SqliteConnectionFactory Factory, INoteRepository Notes)>
        CreateServicesAsync()
    {
        var paths = new AppDataPaths(_testDirectory);
        paths.EnsureCreated();
        await File.WriteAllTextAsync(paths.FirebaseConfigurationPath, """
            {
              "projectId": "test-project",
              "apiKey": "test-api-key",
              "storageBucket": "test-project.firebasestorage.app"
            }
            """);
        var factory = new SqliteConnectionFactory(paths);
        await new SqliteDatabaseInitializer(factory, new NullLogger()).InitializeAsync();
        return (paths, factory, new SqliteNoteRepository(factory));
    }

    private static Note CreateNote(string title, string body) => new()
    {
        Id = Guid.NewGuid().ToString(),
        Title = title,
        BodyJson = "{\"type\":\"doc\"}",
        BodyHtml = $"<p>{body}</p>",
        BodyText = body,
        CreatedAt = DateTimeOffset.UtcNow,
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    private static string BuildRemoteNote(string id, DateTimeOffset updatedAt)
    {
        var fields = new Dictionary<string, object>
        {
            ["notebookId"] = new { nullValue = (object?)null },
            ["title"] = new { stringValue = "Remote title" },
            ["bodyJson"] = new { stringValue = "{\"type\":\"doc\"}" },
            ["bodyHtml"] = new { stringValue = "<p>remote body</p>" },
            ["bodyText"] = new { stringValue = "remote body" },
            ["isPinned"] = new { booleanValue = false },
            ["createdAt"] = new { timestampValue = updatedAt.AddHours(-1).ToString("O") },
            ["updatedAt"] = new { timestampValue = updatedAt.ToString("O") },
            ["deletedAt"] = new { nullValue = (object?)null },
            ["version"] = new { integerValue = "2" },
            ["deviceId"] = new { stringValue = "remote-device" },
            ["tags"] = new { arrayValue = new { values = Array.Empty<object>() } },
        };
        return JsonSerializer.Serialize(new[]
        {
            new
            {
                document = new
                {
                    name = $"projects/test-project/databases/(default)/documents/users/user-1/notes/{id}",
                    fields,
                },
            },
        });
    }

    private static byte[] OnePixelPng => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQ0T8AAAAASUVORK5CYII=");

    private sealed class RecordingFirebaseHandler : HttpMessageHandler
    {
        public List<string> PatchedDocuments { get; } = [];

        public List<string> StorageUploads { get; } = [];

        public string? RemoteNoteResponse { get; init; }

        public bool StorageShouldReturnNotFound { get; init; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.AbsoluteUri;
            if (url.Contains("signInWithPassword", StringComparison.Ordinal))
            {
                return JsonResponse("""
                    {
                      "localId":"user-1",
                      "email":"test@example.com",
                      "idToken":"test-id-token",
                      "refreshToken":"test-refresh-token",
                      "expiresIn":"3600"
                    }
                    """);
            }

            if (url.Contains("oauth2.googleapis.com/token", StringComparison.Ordinal))
            {
                return JsonResponse("""
                    {
                      "id_token":"google-test-id-token",
                      "access_token":"google-test-access-token",
                      "expires_in":3600
                    }
                    """);
            }

            if (url.Contains("signInWithIdp", StringComparison.Ordinal))
            {
                return JsonResponse("""
                    {
                      "localId":"user-google-1",
                      "email":"user@gmail.com",
                      "idToken":"firebase-google-id-token",
                      "refreshToken":"firebase-google-refresh-token",
                      "expiresIn":"3600"
                    }
                    """);
            }

            if (url.Contains(":runQuery", StringComparison.Ordinal))
            {
                var body = await request.Content!.ReadAsStringAsync(cancellationToken);
                return body.Contains("\"collectionId\":\"notes\"", StringComparison.Ordinal) &&
                    RemoteNoteResponse is not null
                        ? JsonResponse(RemoteNoteResponse)
                        : JsonResponse("[]");
            }

            if (url.Contains("/documents:commit", StringComparison.Ordinal) &&
                request.Method == HttpMethod.Post)
            {
                PatchedDocuments.Add(url);
                return JsonResponse("{}");
            }

            if (url.Contains("firebasestorage.googleapis.com", StringComparison.Ordinal) &&
                request.Method == HttpMethod.Post)
            {
                if (StorageShouldReturnNotFound)
                {
                    return new HttpResponseMessage(HttpStatusCode.NotFound)
                    {
                        Content = new StringContent("{\"error\":{\"code\":404,\"message\":\"Not Found.\"}}"),
                    };
                }

                StorageUploads.Add(url);
                return JsonResponse("{}");
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound)
            {
                Content = new StringContent("{\"error\":{\"message\":\"not found\"}}"),
            };
        }

        private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
    }

    private sealed class NullLogger : IAppLogger
    {
        public void Info(string message)
        {
        }

        public void Error(string message, Exception exception)
        {
        }
    }
}

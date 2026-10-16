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
        var uploadedNote = JsonDocument.Parse(handler.CommittedBodies
            .Single(body => body.Contains($"/notes/{note.Id}", StringComparison.Ordinal)));
        using (uploadedNote)
        {
            var uploadedTags = uploadedNote.RootElement.GetProperty("writes")[0].GetProperty("update")
                .GetProperty("fields").GetProperty("tags").GetProperty("arrayValue").GetProperty("values")
                .EnumerateArray().Select(value => value.GetProperty("stringValue").GetString()!).ToArray();
            Assert.Equal(["local", "sync"], uploadedTags);
        }
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
    public async Task NewerLocalNoteIsNotOverwrittenByOlderRemoteNoteAndPushesOutbox()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var local = CreateNote("Local newer title", "local newer body");
        await notes.UpsertAsync(local);
        var remoteUpdatedAt = local.UpdatedAt.AddMinutes(-5);
        var handler = new RecordingFirebaseHandler
        {
            RemoteNoteResponse = BuildRemoteNote(local.Id, remoteUpdatedAt, title: "Remote older title"),
        };
        var service = new FirebaseSyncService(
            paths,
            factory,
            new HttpClient(handler),
            new NullLogger());
        await service.SignInAsync("test@example.com", "password123");

        var result = await service.SyncAsync();
        var stored = await notes.GetAsync(local.Id);

        Assert.Equal(0, result.Downloaded);
        Assert.Equal(0, result.Conflicts);
        Assert.Equal(1, result.Uploaded);
        Assert.Equal("Local newer title", stored?.Title);
        Assert.Equal("local newer body", stored?.BodyText);
        Assert.Equal(SyncState.Clean, stored?.SyncState);
    }

    [Fact]
    public async Task DelayedAttachmentUploadAllowsLocalImageEditing()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Editing during upload", "local text");
        await notes.UpsertAsync(note);
        var attachments = new AttachmentService(paths, factory);
        var image = await attachments.ImportAsync(note.Id, "capture.png", "image/png", OnePixelPng);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new RecordingFirebaseHandler
        {
            OnStorageUpload = () => { entered.TrySetResult(); return release.Task; },
        };
        var service = new FirebaseSyncService(paths, factory, new HttpClient(handler), new NullLogger());
        await service.SignInAsync("test@example.com", "password123");
        var sync = service.SyncAsync();
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            // Bound the failing reproduction to one second instead of freezing a UI for 30 seconds.
            await using (var connection = await factory.OpenAsync())
            await using (var command = connection.CreateCommand())
            {
                command.CommandTimeout = 1;
                command.CommandText = "UPDATE attachments SET width = width WHERE note_id = $noteId;";
                command.Parameters.AddWithValue("$noteId", note.Id);
                Assert.Equal(1, await command.ExecuteNonQueryAsync());
            }
            await attachments.ImportAsync(note.Id, "another-capture.png", "image/png", OnePixelPng);
            await attachments.ReconcileReferencesAsync(note.Id, $"<img src=\"https://lightnote.attachments/{image.RelativePath}\">");
            await notes.UpsertAsync(note with { BodyText = "typed while uploading", UpdatedAt = DateTimeOffset.UtcNow });
            Assert.Equal("typed while uploading", (await notes.GetAsync(note.Id))!.BodyText);
            var textSync = await service.SyncTextAsync().WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(1, textSync.Uploaded);
            Assert.Contains(handler.CommittedBodies, body => body.Contains("typed while uploading", StringComparison.Ordinal));
            Assert.False(sync.IsCompleted);
        }
        finally
        {
            release.TrySetResult();
            await sync.WaitAsync(TimeSpan.FromSeconds(5));
        }
    }

    [Fact]
    public async Task UploadUsesTheCompressedLocalAttachment()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Compressed screenshot", "local text");
        await notes.UpsertAsync(note);
        var settings = new LightNote.Infrastructure.Settings.AppSettingsService(paths);
        settings.Save(new LightNote.Infrastructure.Settings.AppSettings { CompressImages = true });
        var original = ImageCompressorTests.CreateNoisyImage(1080, 2400, SkiaSharp.SKEncodedImageFormat.Png, 100);
        var image = await new AttachmentService(paths, factory, settings).ImportAsync(note.Id, "capture.png", "image/png", original);
        var saved = await File.ReadAllBytesAsync(Path.Combine(paths.AttachmentsDirectory, image.RelativePath));
        Assert.True(saved.Length <= original.Length);
        Assert.Equal(1080, image.Width);
        Assert.Equal(2400, image.Height);
        var handler = new RecordingFirebaseHandler();
        var service = new FirebaseSyncService(paths, factory, new HttpClient(handler), new NullLogger());
        await service.SignInAsync("test@example.com", "password123");
        await service.SyncAsync();
        Assert.Equal(Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(saved)), Assert.Single(handler.StorageUploadHashes));
    }

    [Fact]
    public async Task SyncKeepsAttachmentQueuedWhenCloudStorageBucketNotFound()
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

        // Storage 不可用时不能把附件当作已同步：同步报告部分失败，附件仍留在待同步队列。
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SyncAsync());
        Assert.Empty(handler.StorageUploads);

        await using var connection = await factory.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sync_outbox WHERE entity_type = 'attachment';";
        Assert.Equal(1L, (long)(await command.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task WebEditWithPreservedTagNamesRetainsDesktopTags()
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var note = CreateNote("Desktop", "desktop body");
        await notes.UpsertAsync(note);
        var tags = new SqliteTagRepository(factory);
        await tags.SetForNoteAsync(note.Id, ["研究", "desktop"]);
        var handler = new RecordingFirebaseHandler
        {
            RemoteNoteResponse = BuildRemoteNote(note.Id, DateTimeOffset.UtcNow.AddMinutes(5),
                title: "Web edit", tags: ["研究", "desktop"]),
        };
        var service = new FirebaseSyncService(paths, factory, new HttpClient(handler), new NullLogger());
        await service.SignInAsync("test@example.com", "password123");
        await service.SyncAsync();

        Assert.Equal("Web edit", (await notes.GetAsync(note.Id))?.Title);
        Assert.Equal(["desktop", "研究"], (await tags.ListForNoteAsync(note.Id)).Select(tag => tag.Name));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task WebDeletionFieldsProduceMatchingDesktopVisibility(bool deleted, bool purged)
    {
        var (paths, factory, notes) = await CreateServicesAsync();
        var id = Guid.NewGuid().ToString();
        var handler = new RecordingFirebaseHandler
        {
            RemoteNoteResponse = BuildRemoteNote(id, DateTimeOffset.UtcNow,
                deleted: deleted, purged: purged),
        };
        var service = new FirebaseSyncService(paths, factory, new HttpClient(handler), new NullLogger());
        await service.SignInAsync("test@example.com", "password123");
        await service.SyncAsync();

        var active = await notes.ListAsync(null, allNotebooks: true, deletedOnly: false);
        var trash = await notes.ListAsync(null, allNotebooks: true, deletedOnly: true);
        Assert.Equal(!deleted && !purged, active.Any(note => note.Id == id));
        Assert.Equal(deleted && !purged, trash.Any(note => note.Id == id));
        Assert.Equal(purged, await notes.GetAsync(id) is null);
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

    private static string BuildRemoteNote(string id, DateTimeOffset updatedAt, string title = "Remote title",
        string[]? tags = null, bool deleted = false, bool purged = false)
    {
        var fields = new Dictionary<string, object>
        {
            ["notebookId"] = new { nullValue = (object?)null },
            ["title"] = new { stringValue = title },
            ["bodyJson"] = new { stringValue = "{\"type\":\"doc\"}" },
            ["bodyHtml"] = new { stringValue = "<p>remote body</p>" },
            ["bodyText"] = new { stringValue = "remote body" },
            ["isPinned"] = new { booleanValue = false },
            ["createdAt"] = new { timestampValue = updatedAt.AddHours(-1).ToString("O") },
            ["updatedAt"] = new { timestampValue = updatedAt.ToString("O") },
            ["deletedAt"] = deleted ? (object)new { timestampValue = updatedAt.ToString("O") }
                : new { nullValue = (object?)null },
            ["purgedAt"] = purged ? (object)new { timestampValue = updatedAt.ToString("O") }
                : new { nullValue = (object?)null },
            ["version"] = new { integerValue = "2" },
            ["deviceId"] = new { stringValue = "remote-device" },
            ["tags"] = new { arrayValue = new { values = (tags ?? []).Select(name => new { stringValue = name }).ToArray() } },
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
        public List<string> CommittedBodies { get; } = [];

        public List<string> StorageUploads { get; } = [];
        public List<string> StorageUploadHashes { get; } = [];

        public string? RemoteNoteResponse { get; init; }

        public bool StorageShouldReturnNotFound { get; init; }

        public Func<Task>? OnStorageUpload { get; init; }

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
                CommittedBodies.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
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

                if (OnStorageUpload is not null) await OnStorageUpload();
                StorageUploadHashes.Add(Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(
                    await request.Content!.ReadAsByteArrayAsync(cancellationToken))));
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

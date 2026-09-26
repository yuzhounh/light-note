using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LightNote.Core.Abstractions;
using LightNote.Core.Models;
using LightNote.Infrastructure.Storage;

namespace LightNote.Infrastructure.Sync;

public sealed class FirebaseSyncService(
    AppDataPaths paths,
    SqliteConnectionFactory connectionFactory,
    HttpClient httpClient,
    IAppLogger logger) : IFirebaseSyncService
{
    private readonly FirebaseConfigurationProvider _configurationProvider = new(paths);
    private readonly FirebaseSessionStore _sessionStore = new(paths);
    private readonly SemaphoreSlim _syncGate = new(1, 1);
    private FirebaseSession? _session;

    public bool IsConfigured => _configurationProvider.IsConfigured;

    public string ConfigurationPath => _configurationProvider.ConfigurationPath;

    public FirebaseAccount? CurrentAccount => _session is null
        ? null
        : new FirebaseAccount { UserId = _session.UserId, Email = _session.Email };

    public async Task<FirebaseAccount?> RestoreSessionAsync(
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
        {
            return null;
        }

        try
        {
            _session = _sessionStore.Load();
            if (_session is null)
            {
                return null;
            }

            await EnsureFreshSessionAsync(cancellationToken);
            return CurrentAccount;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.Error("Failed to restore the Firebase session.", exception);
            _session = null;
            _sessionStore.Clear();
            return null;
        }
    }

    public async Task<FirebaseAccount> SignInAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        var configuration = _configurationProvider.Load();
        var endpoint = $"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={Uri.EscapeDataString(configuration.ApiKey)}";
        using var response = await httpClient.PostAsJsonAsync(endpoint, new
        {
            email = email.Trim(),
            password,
            returnSecureToken = true,
        }, cancellationToken);
        using var document = await ReadSuccessfulJsonAsync(response, cancellationToken);
        var root = document.RootElement;
        _session = new FirebaseSession
        {
            UserId = RequiredString(root, "localId"),
            Email = RequiredString(root, "email"),
            IdToken = RequiredString(root, "idToken"),
            RefreshToken = RequiredString(root, "refreshToken"),
            ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(ParseLong(root, "expiresIn")),
        };
        _sessionStore.Save(_session);
        return CurrentAccount!;
    }

    public string? GoogleClientId => _configurationProvider.LoadSafely()?.GoogleClientId;

    public async Task<FirebaseAccount> SignInWithGoogleAsync(
        string? clientId = null,
        string? clientSecret = null,
        Action<string>? openBrowserUrl = null,
        CancellationToken cancellationToken = default)
    {
        var configuration = _configurationProvider.Load();
        var effectiveClientId = !string.IsNullOrWhiteSpace(clientId)
            ? clientId.Trim()
            : configuration.GoogleClientId;
        var effectiveClientSecret = !string.IsNullOrWhiteSpace(clientSecret)
            ? clientSecret.Trim()
            : configuration.GoogleClientSecret;

        if (string.IsNullOrWhiteSpace(effectiveClientId))
        {
            throw new InvalidOperationException("未配置 Google 客户端 ID (Client ID)。");
        }

        if (effectiveClientId != configuration.GoogleClientId ||
            effectiveClientSecret != configuration.GoogleClientSecret)
        {
            _configurationProvider.SaveGoogleCredentials(effectiveClientId, effectiveClientSecret);
        }

        var verifierBytes = new byte[32];
        RandomNumberGenerator.Fill(verifierBytes);
        var codeVerifier = Base64UrlEncode(verifierBytes);
        var codeChallenge = Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier)));

        int port;
        using (var socket = new TcpListener(IPAddress.Loopback, 0))
        {
            socket.Start();
            port = ((IPEndPoint)socket.LocalEndpoint).Port;
            socket.Stop();
        }
        var redirectUri = $"http://127.0.0.1:{port}/";

        using var listener = new HttpListener();
        listener.Prefixes.Add(redirectUri);
        listener.Start();

        var state = Guid.NewGuid().ToString("N");
        var authUrl = $"https://accounts.google.com/o/oauth2/v2/auth?" +
            $"client_id={Uri.EscapeDataString(effectiveClientId)}" +
            $"&redirect_uri={Uri.EscapeDataString(redirectUri)}" +
            $"&response_type=code" +
            $"&scope=openid%20email%20profile" +
            $"&code_challenge={codeChallenge}" +
            $"&code_challenge_method=S256" +
            $"&state={state}";

        if (openBrowserUrl is not null)
        {
            openBrowserUrl(authUrl);
        }
        else
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = authUrl,
                UseShellExecute = true,
            });
        }

        HttpListenerContext context;
        using var reg = cancellationToken.Register(() =>
        {
            try { listener.Stop(); } catch { }
        });

        try
        {
            context = await listener.GetContextAsync();
        }
        catch (Exception) when (cancellationToken.IsCancellationRequested)
        {
            throw new OperationCanceledException("用户取消了 Google 登录授权。", cancellationToken);
        }

        var request = context.Request;
        var response = context.Response;
        var code = request.QueryString["code"];
        var error = request.QueryString["error"];

        var html = error is not null
            ? """
              <!DOCTYPE html><html><head><meta charset="utf-8"><title>LightNote 授权结果</title></head>
              <body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:80vh;text-align:center;background:#f8fafc;color:#1e293b;">
                <div style="background:white;padding:32px 48px;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                  <h2 style="color:#ef4444;margin-bottom:8px;">Google 授权未完成</h2>
                  <p style="color:#64748b;margin:0;">您可以关闭此标签页并返回 LightNote 重新尝试。</p>
                </div>
              </body></html>
              """
            : """
              <!DOCTYPE html><html><head><meta charset="utf-8"><title>LightNote 授权结果</title></head>
              <body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:80vh;text-align:center;background:#f8fafc;color:#1e293b;">
                <div style="background:white;padding:32px 48px;border-radius:12px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                  <h2 style="color:#2563eb;margin-bottom:8px;">Google 账号授权成功</h2>
                  <p style="color:#64748b;margin:0;">已成功验证，您可以关闭此浏览器标签页并返回 LightNote 继续使用。</p>
                </div>
              </body></html>
              """;

        var buffer = Encoding.UTF8.GetBytes(html);
        response.ContentType = "text/html; charset=utf-8";
        response.ContentLength64 = buffer.Length;
        await response.OutputStream.WriteAsync(buffer, cancellationToken);
        response.OutputStream.Close();
        listener.Stop();

        if (error is not null)
        {
            throw new InvalidOperationException($"Google 登录失败：{error}");
        }

        if (string.IsNullOrWhiteSpace(code))
        {
            throw new InvalidOperationException("未从 Google 收到有效的授权码。");
        }

        var tokenParams = new Dictionary<string, string>
        {
            ["code"] = code,
            ["client_id"] = effectiveClientId,
            ["redirect_uri"] = redirectUri,
            ["grant_type"] = "authorization_code",
            ["code_verifier"] = codeVerifier,
        };
        if (!string.IsNullOrWhiteSpace(effectiveClientSecret))
        {
            tokenParams["client_secret"] = effectiveClientSecret;
        }

        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(tokenParams),
        };
        using var tokenResponse = await httpClient.SendAsync(tokenRequest, cancellationToken);
        using var tokenDoc = await ReadSuccessfulJsonAsync(tokenResponse, cancellationToken);
        var googleIdToken = RequiredString(tokenDoc.RootElement, "id_token");

        var idpEndpoint = $"https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key={Uri.EscapeDataString(configuration.ApiKey)}";
        using var idpResponse = await httpClient.PostAsJsonAsync(idpEndpoint, new
        {
            postBody = $"id_token={Uri.EscapeDataString(googleIdToken)}&providerId=google.com",
            requestUri = "http://localhost",
            returnSecureToken = true,
        }, cancellationToken);
        using var idpDoc = await ReadSuccessfulJsonAsync(idpResponse, cancellationToken);
        var root = idpDoc.RootElement;
        _session = new FirebaseSession
        {
            UserId = RequiredString(root, "localId"),
            Email = root.TryGetProperty("email", out var emailProp) && !string.IsNullOrWhiteSpace(emailProp.GetString())
                ? emailProp.GetString()!
                : RequiredString(root, "federatedId"),
            IdToken = RequiredString(root, "idToken"),
            RefreshToken = RequiredString(root, "refreshToken"),
            ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(ParseLong(root, "expiresIn")),
        };
        _sessionStore.Save(_session);
        return CurrentAccount!;
    }

    public Task SignOutAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _session = null;
        _sessionStore.Clear();
        return Task.CompletedTask;
    }

    public async Task<SyncResult> SyncAsync(CancellationToken cancellationToken = default)
    {
        await _syncGate.WaitAsync(cancellationToken);
        try
        {
            var configuration = _configurationProvider.Load();
            var session = await EnsureFreshSessionAsync(cancellationToken);
            var downloaded = 0;
            var conflicts = 0;

            var notebookBatch = await QueryDocumentsAsync(
                configuration,
                session,
                "notebooks",
                await GetLastPullAsync(session.UserId, "notebooks", cancellationToken),
                cancellationToken);
            foreach (var document in notebookBatch.Documents)
            {
                downloaded += await ApplyNotebookAsync(
                    document, notebookBatch.IsInitial, cancellationToken);
            }
            await AdvanceLastPullAsync(
                session.UserId, "notebooks", notebookBatch.Cursor, cancellationToken);

            var noteBatch = await QueryDocumentsAsync(
                configuration,
                session,
                "notes",
                await GetLastPullAsync(session.UserId, "notes", cancellationToken),
                cancellationToken);
            foreach (var document in noteBatch.Documents)
            {
                var outcome = await ApplyNoteAsync(
                    document, noteBatch.IsInitial, cancellationToken);
                downloaded += outcome.Applied ? 1 : 0;
                conflicts += outcome.Conflict ? 1 : 0;
            }
            await AdvanceLastPullAsync(
                session.UserId, "notes", noteBatch.Cursor, cancellationToken);

            var attachmentBatch = await QueryDocumentsAsync(
                configuration,
                session,
                "attachments",
                await GetLastPullAsync(session.UserId, "attachments", cancellationToken),
                cancellationToken);
            foreach (var document in attachmentBatch.Documents)
            {
                downloaded += await ApplyAttachmentAsync(
                    configuration,
                    session,
                    document,
                    attachmentBatch.IsInitial,
                    cancellationToken);
            }
            await AdvanceLastPullAsync(
                session.UserId, "attachments", attachmentBatch.Cursor, cancellationToken);

            var uploaded = await PushOutboxAsync(configuration, session, cancellationToken);
            return new SyncResult
            {
                Uploaded = uploaded,
                Downloaded = downloaded,
                Conflicts = conflicts,
                CompletedAt = DateTimeOffset.UtcNow,
            };
        }
        finally
        {
            _syncGate.Release();
        }
    }

    private async Task<FirebaseSession> EnsureFreshSessionAsync(CancellationToken cancellationToken)
    {
        _session ??= _sessionStore.Load();
        if (_session is null)
        {
            throw new InvalidOperationException("请先登录 Firebase 账户。");
        }

        if (_session.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(2))
        {
            return _session;
        }

        var configuration = _configurationProvider.Load();
        var endpoint = $"https://securetoken.googleapis.com/v1/token?key={Uri.EscapeDataString(configuration.ApiKey)}";
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = _session.RefreshToken,
        });
        using var response = await httpClient.PostAsync(endpoint, content, cancellationToken);
        using var document = await ReadSuccessfulJsonAsync(response, cancellationToken);
        var root = document.RootElement;
        _session = _session with
        {
            IdToken = RequiredString(root, "id_token"),
            RefreshToken = RequiredString(root, "refresh_token"),
            UserId = RequiredString(root, "user_id"),
            ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(ParseLong(root, "expires_in")),
        };
        _sessionStore.Save(_session);
        return _session;
    }

    private async Task<int> PushOutboxAsync(
        FirebaseConfiguration configuration,
        FirebaseSession session,
        CancellationToken cancellationToken)
    {
        var items = await ListOutboxAsync(cancellationToken);
        var uploaded = 0;
        Exception? firstError = null;
        foreach (var item in items)
        {
            try
            {
                var fields = item.EntityType switch
                {
                    "notebook" => await ReadNotebookFieldsAsync(item.EntityId, cancellationToken),
                    "note" => await ReadNoteFieldsAsync(item.EntityId, cancellationToken),
                    "attachment" => await ReadAttachmentFieldsAsync(
                        configuration, session, item.EntityId, cancellationToken),
                    _ => null,
                };
                if (fields is null)
                {
                    await CompleteOutboxAsync(item, cancellationToken);
                    continue;
                }

                await PatchDocumentAsync(
                    configuration,
                    session,
                    CollectionName(item.EntityType),
                    item.EntityId,
                    fields,
                    cancellationToken);
                await CompleteOutboxAsync(item, cancellationToken);
                uploaded++;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                firstError ??= exception;
                await RecordOutboxFailureAsync(item, exception.Message, cancellationToken);
                logger.Error($"Failed to sync {item.EntityType} {item.EntityId}.", exception);
            }
        }

        if (firstError is not null)
        {
            throw new InvalidOperationException("部分内容同步失败，稍后将自动重试。", firstError);
        }

        return uploaded;
    }

    private async Task<QueryBatch> QueryDocumentsAsync(
        FirebaseConfiguration configuration,
        FirebaseSession session,
        string collection,
        DateTimeOffset? updatedAfter,
        CancellationToken cancellationToken)
    {
        var endpoint = $"{FirestoreBase(configuration)}/documents/users/{Uri.EscapeDataString(session.UserId)}:runQuery";
        var structuredQuery = new JsonObject
        {
            ["from"] = new JsonArray(new JsonObject { ["collectionId"] = collection }),
        };
        if (updatedAfter is not null)
        {
            structuredQuery["where"] = new JsonObject
            {
                ["fieldFilter"] = new JsonObject
                {
                    ["field"] = new JsonObject { ["fieldPath"] = "serverUpdatedAt" },
                    ["op"] = "GREATER_THAN_OR_EQUAL",
                    ["value"] = TimestampValue(updatedAfter.Value),
                },
            };
            structuredQuery["orderBy"] = new JsonArray(new JsonObject
            {
                ["field"] = new JsonObject { ["fieldPath"] = "serverUpdatedAt" },
                ["direction"] = "ASCENDING",
            });
        }

        var body = new JsonObject
        {
            ["structuredQuery"] = structuredQuery,
        };
        using var request = CreateAuthorizedRequest(HttpMethod.Post, endpoint, session.IdToken);
        request.Content = JsonContent.Create(body);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        using var responseDocument = await ReadSuccessfulJsonAsync(response, cancellationToken);
        var documents = new List<JsonElement>();
        DateTimeOffset? cursor = updatedAfter;
        foreach (var result in responseDocument.RootElement.EnumerateArray())
        {
            if (result.TryGetProperty("document", out var document))
            {
                documents.Add(document.Clone());
                var serverUpdatedAt = GetServerUpdatedAt(document);
                if (serverUpdatedAt is not null && (cursor is null || serverUpdatedAt > cursor))
                {
                    cursor = serverUpdatedAt;
                }
            }
        }

        return new QueryBatch(documents, cursor, updatedAfter is null);
    }

    private async Task PatchDocumentAsync(
        FirebaseConfiguration configuration,
        FirebaseSession session,
        string collection,
        string documentId,
        JsonObject fields,
        CancellationToken cancellationToken)
    {
        var endpoint = $"{FirestoreBase(configuration)}/documents:commit";
        var documentName = $"projects/{configuration.ProjectId}/databases/{configuration.DatabaseId}/documents/users/{session.UserId}/{collection}/{documentId}";
        var body = new JsonObject
        {
            ["writes"] = new JsonArray(new JsonObject
            {
                ["update"] = new JsonObject
                {
                    ["name"] = documentName,
                    ["fields"] = fields,
                },
                ["updateTransforms"] = new JsonArray(new JsonObject
                {
                    ["fieldPath"] = "serverUpdatedAt",
                    ["setToServerValue"] = "REQUEST_TIME",
                }),
            }),
        };
        using var request = CreateAuthorizedRequest(HttpMethod.Post, endpoint, session.IdToken);
        request.Content = JsonContent.Create(body);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        _ = await ReadSuccessfulJsonAsync(response, cancellationToken);
    }

    private async Task<JsonObject?> ReadNoteFieldsAsync(string id, CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT notebook_id, title, body_json, body_html, body_text, is_pinned,
                   created_at, updated_at, deleted_at, version, purged_at
            FROM notes WHERE id = $id LIMIT 1;
            """;
        command.Parameters.AddWithValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new JsonObject
        {
            ["notebookId"] = NullableStringValue(reader.IsDBNull(0) ? null : reader.GetString(0)),
            ["title"] = StringValue(reader.GetString(1)),
            ["bodyJson"] = StringValue(reader.GetString(2)),
            ["bodyHtml"] = StringValue(reader.GetString(3)),
            ["bodyText"] = StringValue(reader.GetString(4)),
            ["isPinned"] = BooleanValue(reader.GetInt64(5) == 1),
            ["createdAt"] = TimestampValue(ParseTimestamp(reader.GetString(6))),
            ["updatedAt"] = TimestampValue(ParseTimestamp(reader.GetString(7))),
            ["deletedAt"] = NullableTimestampValue(reader.IsDBNull(8) ? null : ParseTimestamp(reader.GetString(8))),
            ["version"] = IntegerValue(reader.GetInt64(9)),
            ["purgedAt"] = NullableTimestampValue(reader.IsDBNull(10) ? null : ParseTimestamp(reader.GetString(10))),
            ["deviceId"] = StringValue(await GetDeviceIdAsync(cancellationToken)),
            ["tags"] = StringArrayValue(await ListTagNamesAsync(id, cancellationToken)),
        };
    }

    private async Task<JsonObject?> ReadNotebookFieldsAsync(string id, CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT name, sort_order, created_at, updated_at, deleted_at
            FROM notebooks WHERE id = $id LIMIT 1;
            """;
        command.Parameters.AddWithValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new JsonObject
        {
            ["name"] = StringValue(reader.GetString(0)),
            ["sortOrder"] = IntegerValue(reader.GetInt64(1)),
            ["createdAt"] = TimestampValue(ParseTimestamp(reader.GetString(2))),
            ["updatedAt"] = TimestampValue(ParseTimestamp(reader.GetString(3))),
            ["deletedAt"] = NullableTimestampValue(reader.IsDBNull(4) ? null : ParseTimestamp(reader.GetString(4))),
            ["deviceId"] = StringValue(await GetDeviceIdAsync(cancellationToken)),
        };
    }

    private async Task<JsonObject?> ReadAttachmentFieldsAsync(
        FirebaseConfiguration configuration,
        FirebaseSession session,
        string id,
        CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT note_id, relative_path, mime_type, size, width, height, sha256,
                   created_at, deleted_at, updated_at
            FROM attachments WHERE id = $id LIMIT 1;
            """;
        command.Parameters.AddWithValue("$id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var relativePath = reader.GetString(1);
        var mimeType = reader.GetString(2);
        var cloudPath = $"users/{session.UserId}/attachments/{reader.GetString(6)}/{Path.GetFileName(relativePath)}";
        if (reader.IsDBNull(8))
        {
            var localPath = ResolveAttachmentPath(relativePath);
            if (File.Exists(localPath))
            {
                await UploadAttachmentAsync(
                    configuration, session, cloudPath, mimeType, localPath, cancellationToken);
            }
        }

        return new JsonObject
        {
            ["noteId"] = StringValue(reader.GetString(0)),
            ["relativePath"] = StringValue(relativePath),
            ["cloudPath"] = StringValue(cloudPath),
            ["mimeType"] = StringValue(mimeType),
            ["size"] = IntegerValue(reader.GetInt64(3)),
            ["width"] = IntegerValue(reader.IsDBNull(4) ? 0 : reader.GetInt64(4)),
            ["height"] = IntegerValue(reader.IsDBNull(5) ? 0 : reader.GetInt64(5)),
            ["sha256"] = StringValue(reader.GetString(6)),
            ["createdAt"] = TimestampValue(ParseTimestamp(reader.GetString(7))),
            ["updatedAt"] = TimestampValue(ParseTimestamp(reader.GetString(9))),
            ["deletedAt"] = NullableTimestampValue(reader.IsDBNull(8) ? null : ParseTimestamp(reader.GetString(8))),
        };
    }

    private async Task UploadAttachmentAsync(
        FirebaseConfiguration configuration,
        FirebaseSession session,
        string cloudPath,
        string mimeType,
        string localPath,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(configuration.StorageBucket))
        {
            return;
        }

        var endpoint = $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(configuration.StorageBucket)}/o?uploadType=media&name={Uri.EscapeDataString(cloudPath)}";
        using var request = CreateAuthorizedRequest(HttpMethod.Post, endpoint, session.IdToken);
        await using var stream = new FileStream(localPath, FileMode.Open, FileAccess.Read, FileShare.Read);
        request.Content = new StreamContent(stream);
        request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(mimeType);
        using var response = await httpClient.SendAsync(request, cancellationToken);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden)
        {
            logger.Info($"Cloud Storage 未开启或存储桶不可用（{(int)response.StatusCode}），已跳过附件云端上传：{cloudPath}");
            return;
        }

        _ = await ReadSuccessfulJsonAsync(response, cancellationToken);
    }

    private async Task<int> ApplyNotebookAsync(
        JsonElement document,
        bool isInitial,
        CancellationToken cancellationToken)
    {
        var id = DocumentId(document);
        var fields = document.GetProperty("fields");
        var remoteUpdatedAt = GetTimestamp(fields, "updatedAt");
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO notebooks (id, name, sort_order, created_at, updated_at, deleted_at)
            VALUES ($id, $name, $sortOrder, $createdAt, $updatedAt, $deletedAt)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at
            WHERE $isInitial = 0 OR excluded.updated_at > notebooks.updated_at;
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$name", GetString(fields, "name"));
        command.Parameters.AddWithValue("$sortOrder", GetInteger(fields, "sortOrder"));
        command.Parameters.AddWithValue("$createdAt", GetTimestamp(fields, "createdAt").ToString("O"));
        command.Parameters.AddWithValue("$updatedAt", remoteUpdatedAt.ToString("O"));
        command.Parameters.AddWithValue("$deletedAt", DbTimestamp(GetNullableTimestamp(fields, "deletedAt")));
        command.Parameters.AddWithValue("$isInitial", isInitial ? 1 : 0);
        var applied = await command.ExecuteNonQueryAsync(cancellationToken);
        if (applied > 0)
        {
            await using var removeOutbox = connection.CreateCommand();
            removeOutbox.Transaction = transaction;
            removeOutbox.CommandText = """
                DELETE FROM sync_outbox
                WHERE entity_type = 'notebook' AND entity_id = $id;
                """;
            removeOutbox.Parameters.AddWithValue("$id", id);
            await removeOutbox.ExecuteNonQueryAsync(cancellationToken);
        }
        await transaction.CommitAsync(cancellationToken);
        return applied > 0 ? 1 : 0;
    }

    private async Task<(bool Applied, bool Conflict)> ApplyNoteAsync(
        JsonElement document,
        bool isInitial,
        CancellationToken cancellationToken)
    {
        var id = DocumentId(document);
        var fields = document.GetProperty("fields");
        var remoteUpdatedAt = GetTimestamp(fields, "updatedAt");
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        LocalNote? local = null;
        await using (var select = connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = """
                SELECT title, body_json, body_html, body_text, updated_at, version,
                       EXISTS(SELECT 1 FROM sync_outbox WHERE entity_type = 'note' AND entity_id = notes.id)
                FROM notes WHERE id = $id LIMIT 1;
                """;
            select.Parameters.AddWithValue("$id", id);
            await using var reader = await select.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                local = new LocalNote(
                    reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                    ParseTimestamp(reader.GetString(4)), reader.GetInt64(5), reader.GetInt64(6) == 1);
            }
        }

        if (isInitial && local is not null && local.UpdatedAt >= remoteUpdatedAt)
        {
            await transaction.CommitAsync(cancellationToken);
            return (false, false);
        }

        var conflict = local is { IsDirty: true } &&
            (local.Title != GetString(fields, "title") || local.BodyJson != GetString(fields, "bodyJson"));
        if (conflict)
        {
            await using var versionCommand = connection.CreateCommand();
            versionCommand.Transaction = transaction;
            versionCommand.CommandText = """
                INSERT INTO note_versions (
                    id, note_id, version, body_json, title, created_at,
                    source_device_id, body_html, body_text, is_conflict)
                VALUES (
                    $id, $noteId,
                    COALESCE((SELECT MAX(version) + 1 FROM note_versions WHERE note_id = $noteId), 1),
                    $bodyJson, $title, $createdAt, $deviceId, $bodyHtml, $bodyText, 1);
                """;
            versionCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
            versionCommand.Parameters.AddWithValue("$noteId", id);
            versionCommand.Parameters.AddWithValue("$bodyJson", local!.BodyJson);
            versionCommand.Parameters.AddWithValue("$title", local.Title);
            versionCommand.Parameters.AddWithValue("$createdAt", local.UpdatedAt.ToString("O"));
            versionCommand.Parameters.AddWithValue("$deviceId", GetOptionalString(fields, "deviceId") ?? "remote");
            versionCommand.Parameters.AddWithValue("$bodyHtml", local.BodyHtml);
            versionCommand.Parameters.AddWithValue("$bodyText", local.BodyText);
            await versionCommand.ExecuteNonQueryAsync(cancellationToken);

            await using var trimCommand = connection.CreateCommand();
            trimCommand.Transaction = transaction;
            trimCommand.CommandText = """
                DELETE FROM note_versions
                WHERE note_id = $noteId
                  AND id NOT IN (
                      SELECT id FROM note_versions
                      WHERE note_id = $noteId
                      ORDER BY created_at DESC
                      LIMIT 20
                  );
                """;
            trimCommand.Parameters.AddWithValue("$noteId", id);
            await trimCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var upsert = connection.CreateCommand();
        upsert.Transaction = transaction;
        upsert.CommandText = """
            INSERT INTO notes (
                id, notebook_id, title, body_json, body_html, body_text, is_pinned,
                created_at, updated_at, deleted_at, version, sync_state,
                purged_at, sync_revision)
            VALUES (
                $id, $notebookId, $title, $bodyJson, $bodyHtml, $bodyText, $isPinned,
                $createdAt, $updatedAt, $deletedAt, $version, 'clean',
                $purgedAt, 1)
            ON CONFLICT(id) DO UPDATE SET
                notebook_id = excluded.notebook_id, title = excluded.title,
                body_json = excluded.body_json, body_html = excluded.body_html,
                body_text = excluded.body_text, is_pinned = excluded.is_pinned,
                updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
                version = excluded.version, sync_state = 'clean',
                purged_at = excluded.purged_at;
            DELETE FROM sync_outbox WHERE entity_type = 'note' AND entity_id = $id;
            """;
        upsert.Parameters.AddWithValue("$id", id);
        upsert.Parameters.AddWithValue("$notebookId", DbString(GetOptionalString(fields, "notebookId")));
        upsert.Parameters.AddWithValue("$title", GetString(fields, "title"));
        upsert.Parameters.AddWithValue("$bodyJson", GetString(fields, "bodyJson"));
        upsert.Parameters.AddWithValue("$bodyHtml", GetString(fields, "bodyHtml"));
        upsert.Parameters.AddWithValue("$bodyText", GetString(fields, "bodyText"));
        upsert.Parameters.AddWithValue("$isPinned", GetBoolean(fields, "isPinned") ? 1 : 0);
        upsert.Parameters.AddWithValue("$createdAt", GetTimestamp(fields, "createdAt").ToString("O"));
        upsert.Parameters.AddWithValue("$updatedAt", remoteUpdatedAt.ToString("O"));
        upsert.Parameters.AddWithValue("$deletedAt", DbTimestamp(GetNullableTimestamp(fields, "deletedAt")));
        upsert.Parameters.AddWithValue("$version", GetInteger(fields, "version"));
        upsert.Parameters.AddWithValue("$purgedAt", DbTimestamp(GetNullableTimestamp(fields, "purgedAt")));
        await upsert.ExecuteNonQueryAsync(cancellationToken);

        if (fields.TryGetProperty("tags", out var tagsValue))
        {
            await using var deleteTags = connection.CreateCommand();
            deleteTags.Transaction = transaction;
            deleteTags.CommandText = "DELETE FROM note_tags WHERE note_id = $noteId;";
            deleteTags.Parameters.AddWithValue("$noteId", id);
            await deleteTags.ExecuteNonQueryAsync(cancellationToken);
            foreach (var tagName in GetStringArray(tagsValue))
            {
                await using var tagCommand = connection.CreateCommand();
                tagCommand.Transaction = transaction;
                tagCommand.CommandText = """
                    INSERT INTO tags (id, name, created_at)
                    VALUES ($id, $name, $createdAt)
                    ON CONFLICT(name) DO NOTHING;
                    INSERT INTO note_tags (note_id, tag_id, created_at)
                    SELECT $noteId, id, $createdAt FROM tags WHERE name = $name COLLATE NOCASE;
                    """;
                tagCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
                tagCommand.Parameters.AddWithValue("$name", tagName);
                tagCommand.Parameters.AddWithValue("$createdAt", DateTimeOffset.UtcNow.ToString("O"));
                tagCommand.Parameters.AddWithValue("$noteId", id);
                await tagCommand.ExecuteNonQueryAsync(cancellationToken);
            }
        }
        await transaction.CommitAsync(cancellationToken);
        return (true, conflict);
    }

    private async Task<int> ApplyAttachmentAsync(
        FirebaseConfiguration configuration,
        FirebaseSession session,
        JsonElement document,
        bool isInitial,
        CancellationToken cancellationToken)
    {
        var id = DocumentId(document);
        var fields = document.GetProperty("fields");
        var relativePath = GetString(fields, "relativePath");
        var deletedAt = GetNullableTimestamp(fields, "deletedAt");
        var remoteUpdatedAt = GetTimestamp(fields, "updatedAt");
        await using (var localConnection = await connectionFactory.OpenAsync(cancellationToken))
        await using (var localCommand = localConnection.CreateCommand())
        {
            localCommand.CommandText = """
                SELECT updated_at,
                       EXISTS(SELECT 1 FROM sync_outbox
                              WHERE entity_type = 'attachment' AND entity_id = $id)
                FROM attachments WHERE id = $id LIMIT 1;
                """;
            localCommand.Parameters.AddWithValue("$id", id);
            await using var localReader = await localCommand.ExecuteReaderAsync(cancellationToken);
            if (isInitial &&
                await localReader.ReadAsync(cancellationToken) &&
                localReader.GetInt64(1) == 1 &&
                ParseTimestamp(localReader.GetString(0)) >= remoteUpdatedAt)
            {
                return 0;
            }
        }

        if (deletedAt is null)
        {
            var destination = ResolveAttachmentPath(relativePath);
            await DownloadAttachmentAsync(
                configuration,
                session,
                GetString(fields, "cloudPath"),
                destination,
                GetInteger(fields, "size"),
                GetString(fields, "sha256"),
                cancellationToken);
        }

        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO attachments (
                id, note_id, relative_path, cloud_path, mime_type, size,
                width, height, sha256, created_at, deleted_at, sync_state,
                updated_at, purged_at, sync_revision)
            VALUES (
                $id, $noteId, $relativePath, $cloudPath, $mimeType, $size,
                $width, $height, $sha256, $createdAt, $deletedAt, 'clean',
                $updatedAt, NULL, 1)
            ON CONFLICT(id) DO UPDATE SET
                note_id = excluded.note_id, relative_path = excluded.relative_path,
                cloud_path = excluded.cloud_path,
                mime_type = excluded.mime_type, size = excluded.size,
                width = excluded.width, height = excluded.height,
                sha256 = excluded.sha256, updated_at = excluded.updated_at,
                deleted_at = excluded.deleted_at, purged_at = NULL,
                sync_state = 'clean';
            DELETE FROM sync_outbox WHERE entity_type = 'attachment' AND entity_id = $id;
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$noteId", GetString(fields, "noteId"));
        command.Parameters.AddWithValue("$relativePath", relativePath);
        command.Parameters.AddWithValue("$cloudPath", GetString(fields, "cloudPath"));
        command.Parameters.AddWithValue("$mimeType", GetString(fields, "mimeType"));
        command.Parameters.AddWithValue("$size", GetInteger(fields, "size"));
        command.Parameters.AddWithValue("$width", GetInteger(fields, "width"));
        command.Parameters.AddWithValue("$height", GetInteger(fields, "height"));
        command.Parameters.AddWithValue("$sha256", GetString(fields, "sha256"));
        command.Parameters.AddWithValue("$createdAt", GetTimestamp(fields, "createdAt").ToString("O"));
        command.Parameters.AddWithValue("$deletedAt", DbTimestamp(deletedAt));
        command.Parameters.AddWithValue("$updatedAt", remoteUpdatedAt.ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return 1;
    }

    private async Task DownloadAttachmentAsync(
        FirebaseConfiguration configuration,
        FirebaseSession session,
        string cloudPath,
        string destination,
        long expectedSize,
        string expectedHash,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(configuration.StorageBucket))
        {
            return;
        }

        if (File.Exists(destination) &&
            new FileInfo(destination).Length == expectedSize &&
            string.Equals(
                await ComputeSha256Async(destination, cancellationToken),
                expectedHash,
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        var temporaryPath = $"{destination}.{Guid.NewGuid():N}.tmp";
        try
        {
            var endpoint = $"https://firebasestorage.googleapis.com/v0/b/{Uri.EscapeDataString(configuration.StorageBucket)}/o/{Uri.EscapeDataString(cloudPath)}?alt=media";
            using var request = CreateAuthorizedRequest(HttpMethod.Get, endpoint, session.IdToken);
            using var response = await httpClient.SendAsync(request, cancellationToken);
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden)
            {
                logger.Info($"Cloud Storage 未开启或云端附件不存在（{(int)response.StatusCode}）：{cloudPath}");
                return;
            }

            if (!response.IsSuccessStatusCode)
            {
                _ = await ReadSuccessfulJsonAsync(response, cancellationToken);
            }

            await using (var source = await response.Content.ReadAsStreamAsync(cancellationToken))
            await using (var target = new FileStream(
                             temporaryPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             81920,
                             useAsync: true))
            {
                await source.CopyToAsync(target, cancellationToken);
            }

            var actualSize = new FileInfo(temporaryPath).Length;
            var actualHash = await ComputeSha256Async(temporaryPath, cancellationToken);
            if (actualSize != expectedSize ||
                !string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("同步附件的大小或 SHA-256 校验失败。");
            }

            File.Move(temporaryPath, destination, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    private static async Task<string> ComputeSha256Async(
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            81920,
            useAsync: true);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken));
    }

    private async Task<IReadOnlyList<OutboxItem>> ListOutboxAsync(CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, entity_type, entity_id, local_version, attempt_count
            FROM sync_outbox
            WHERE next_attempt_at IS NULL OR next_attempt_at <= $now
            ORDER BY CASE entity_type WHEN 'notebook' THEN 0 WHEN 'note' THEN 1 ELSE 2 END, rowid
            LIMIT 200;
            """;
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        var items = new List<OutboxItem>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            items.Add(new OutboxItem(
                reader.GetString(0), reader.GetString(1), reader.GetString(2),
                reader.GetInt64(3), reader.GetInt32(4)));
        }
        return items;
    }

    private async Task CompleteOutboxAsync(OutboxItem item, CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            DELETE FROM sync_outbox
            WHERE id = $id AND local_version = $version;
            UPDATE notes SET sync_state = 'clean'
            WHERE id = $entityId AND sync_revision = $version
              AND $entityType = 'note'
              AND NOT EXISTS (
                  SELECT 1 FROM sync_outbox
                  WHERE entity_type = 'note' AND entity_id = $entityId
              );
            UPDATE attachments SET sync_state = 'clean'
            WHERE id = $entityId AND sync_revision = $version
              AND $entityType = 'attachment'
              AND NOT EXISTS (
                  SELECT 1 FROM sync_outbox
                  WHERE entity_type = 'attachment' AND entity_id = $entityId
              );
            """;
        command.Parameters.AddWithValue("$id", item.Id);
        command.Parameters.AddWithValue("$version", item.LocalVersion);
        command.Parameters.AddWithValue("$entityId", item.EntityId);
        command.Parameters.AddWithValue("$entityType", item.EntityType);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task RecordOutboxFailureAsync(
        OutboxItem item,
        string error,
        CancellationToken cancellationToken)
    {
        var minutes = Math.Min(60, Math.Pow(2, Math.Min(item.AttemptCount, 5)));
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE sync_outbox
            SET attempt_count = attempt_count + 1,
                next_attempt_at = $nextAttemptAt,
                last_error = $lastError
            WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$nextAttemptAt", DateTimeOffset.UtcNow.AddMinutes(minutes).ToString("O"));
        command.Parameters.AddWithValue("$lastError", error.Length > 1000 ? error[..1000] : error);
        command.Parameters.AddWithValue("$id", item.Id);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task RemoveOutboxAsync(
        string entityType,
        string entityId,
        CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM sync_outbox WHERE entity_type = $type AND entity_id = $id;";
        command.Parameters.AddWithValue("$type", entityType);
        command.Parameters.AddWithValue("$id", entityId);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<DateTimeOffset?> GetLastPullAsync(
        string userId,
        string collection,
        CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM sync_metadata WHERE key = $key LIMIT 1;";
        command.Parameters.AddWithValue("$key", $"last_server_pull:{userId}:{collection}");
        var value = (string?)await command.ExecuteScalarAsync(cancellationToken);
        return value is null ? null : ParseTimestamp(value);
    }

    private async Task AdvanceLastPullAsync(
        string userId,
        string collection,
        DateTimeOffset? value,
        CancellationToken cancellationToken)
    {
        if (value is null)
        {
            return;
        }

        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO sync_metadata (key, value) VALUES ($key, $value)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
            """;
        command.Parameters.AddWithValue("$key", $"last_server_pull:{userId}:{collection}");
        command.Parameters.AddWithValue("$value", value.Value.ToUniversalTime().ToString("O"));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task<string> GetDeviceIdAsync(CancellationToken cancellationToken)
    {
        const string key = "device_id";
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();
        await using var select = connection.CreateCommand();
        select.Transaction = transaction;
        select.CommandText = "SELECT value FROM sync_metadata WHERE key = $key LIMIT 1;";
        select.Parameters.AddWithValue("$key", key);
        var existing = (string?)await select.ExecuteScalarAsync(cancellationToken);
        if (existing is not null)
        {
            await transaction.CommitAsync(cancellationToken);
            return existing;
        }

        var deviceId = Guid.NewGuid().ToString();
        await using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = "INSERT INTO sync_metadata (key, value) VALUES ($key, $value);";
        insert.Parameters.AddWithValue("$key", key);
        insert.Parameters.AddWithValue("$value", deviceId);
        await insert.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return deviceId;
    }

    private async Task<IReadOnlyList<string>> ListTagNamesAsync(
        string noteId,
        CancellationToken cancellationToken)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT t.name FROM tags AS t
            INNER JOIN note_tags AS nt ON nt.tag_id = t.id
            WHERE nt.note_id = $noteId
            ORDER BY t.name COLLATE NOCASE;
            """;
        command.Parameters.AddWithValue("$noteId", noteId);
        var names = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            names.Add(reader.GetString(0));
        }
        return names;
    }

    private string ResolveAttachmentPath(string relativePath)
    {
        var root = Path.GetFullPath(paths.AttachmentsDirectory) + Path.DirectorySeparatorChar;
        var candidate = Path.GetFullPath(Path.Combine(
            paths.AttachmentsDirectory,
            relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("同步附件路径超出数据目录。");
        }
        return candidate;
    }

    private static HttpRequestMessage CreateAuthorizedRequest(
        HttpMethod method,
        string endpoint,
        string idToken)
    {
        var request = new HttpRequestMessage(method, endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        return request;
    }

    private static async Task<JsonDocument> ReadSuccessfulJsonAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var payload = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var message = payload;
            try
            {
                using var error = JsonDocument.Parse(payload);
                message = error.RootElement.GetProperty("error").TryGetProperty("message", out var detail)
                    ? detail.GetString() ?? payload
                    : payload;
            }
            catch (JsonException)
            {
            }
            throw new HttpRequestException($"Firebase 请求失败（{(int)response.StatusCode}）：{message}");
        }
        return JsonDocument.Parse(string.IsNullOrWhiteSpace(payload) ? "{}" : payload);
    }

    private static string FirestoreBase(FirebaseConfiguration configuration) =>
        $"https://firestore.googleapis.com/v1/projects/{Uri.EscapeDataString(configuration.ProjectId)}/databases/{Uri.EscapeDataString(configuration.DatabaseId)}";

    private static string CollectionName(string entityType) => entityType switch
    {
        "note" => "notes",
        "notebook" => "notebooks",
        "attachment" => "attachments",
        _ => throw new InvalidOperationException($"未知同步实体：{entityType}"),
    };

    private static string DocumentId(JsonElement document) =>
        document.GetProperty("name").GetString()!.Split('/')[^1];

    private static JsonObject StringValue(string value) => new() { ["stringValue"] = value };

    private static JsonObject NullableStringValue(string? value) => value is null
        ? new JsonObject { ["nullValue"] = null }
        : StringValue(value);

    private static JsonObject IntegerValue(long value) => new() { ["integerValue"] = value.ToString(CultureInfo.InvariantCulture) };

    private static JsonObject BooleanValue(bool value) => new() { ["booleanValue"] = value };

    private static JsonObject StringArrayValue(IEnumerable<string> values) => new()
    {
        ["arrayValue"] = new JsonObject
        {
            ["values"] = new JsonArray(values.Select(value => (JsonNode)StringValue(value)).ToArray()),
        },
    };

    private static JsonObject TimestampValue(DateTimeOffset value) =>
        new() { ["timestampValue"] = value.ToUniversalTime().ToString("O") };

    private static JsonObject NullableTimestampValue(DateTimeOffset? value) => value is null
        ? new JsonObject { ["nullValue"] = null }
        : TimestampValue(value.Value);

    private static string RequiredString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()!
            : throw new InvalidDataException($"Firebase 响应缺少 {property}。");

    private static long ParseLong(JsonElement element, string property) =>
        long.Parse(RequiredString(element, property), CultureInfo.InvariantCulture);

    private static string GetString(JsonElement fields, string name) =>
        fields.GetProperty(name).GetProperty("stringValue").GetString() ?? string.Empty;

    private static string? GetOptionalString(JsonElement fields, string name)
    {
        if (!fields.TryGetProperty(name, out var value) || value.TryGetProperty("nullValue", out _))
        {
            return null;
        }
        return value.TryGetProperty("stringValue", out var text) ? text.GetString() : null;
    }

    private static long GetInteger(JsonElement fields, string name)
    {
        var value = fields.GetProperty(name).GetProperty("integerValue");
        return value.ValueKind == JsonValueKind.String
            ? long.Parse(value.GetString()!, CultureInfo.InvariantCulture)
            : value.GetInt64();
    }

    private static bool GetBoolean(JsonElement fields, string name) =>
        fields.GetProperty(name).GetProperty("booleanValue").GetBoolean();

    private static IReadOnlyList<string> GetStringArray(JsonElement value)
    {
        if (!value.TryGetProperty("arrayValue", out var array) ||
            !array.TryGetProperty("values", out var values))
        {
            return [];
        }
        return values.EnumerateArray()
            .Select(item => item.GetProperty("stringValue").GetString() ?? string.Empty)
            .Where(item => item.Length > 0)
            .ToArray();
    }

    private static DateTimeOffset GetTimestamp(JsonElement fields, string name) =>
        ParseTimestamp(fields.GetProperty(name).GetProperty("timestampValue").GetString()!);

    private static DateTimeOffset? GetNullableTimestamp(JsonElement fields, string name)
    {
        if (!fields.TryGetProperty(name, out var value) || value.TryGetProperty("nullValue", out _))
        {
            return null;
        }
        return ParseTimestamp(value.GetProperty("timestampValue").GetString()!);
    }

    private static DateTimeOffset ParseTimestamp(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    private static DateTimeOffset? GetServerUpdatedAt(JsonElement document)
    {
        if (document.TryGetProperty("fields", out var fields) &&
            fields.TryGetProperty("serverUpdatedAt", out var serverValue) &&
            serverValue.TryGetProperty("timestampValue", out var serverTimestamp) &&
            serverTimestamp.ValueKind == JsonValueKind.String)
        {
            return ParseTimestamp(serverTimestamp.GetString()!);
        }

        return document.TryGetProperty("updateTime", out var updateTime) &&
               updateTime.ValueKind == JsonValueKind.String
            ? ParseTimestamp(updateTime.GetString()!)
            : null;
    }

    private static object DbTimestamp(DateTimeOffset? value) =>
        value is null ? DBNull.Value : value.Value.ToUniversalTime().ToString("O");

    private static object DbString(string? value) => value is null ? DBNull.Value : value;

    private static string Base64UrlEncode(byte[] input) =>
        Convert.ToBase64String(input)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

    private sealed record OutboxItem(
        string Id,
        string EntityType,
        string EntityId,
        long LocalVersion,
        int AttemptCount);

    private sealed record QueryBatch(
        IReadOnlyList<JsonElement> Documents,
        DateTimeOffset? Cursor,
        bool IsInitial);

    private sealed record LocalNote(
        string Title,
        string BodyJson,
        string BodyHtml,
        string BodyText,
        DateTimeOffset UpdatedAt,
        long Version,
        bool IsDirty);
}

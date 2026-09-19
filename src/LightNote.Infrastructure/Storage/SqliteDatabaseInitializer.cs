using LightNote.Core.Abstractions;

namespace LightNote.Infrastructure.Storage;

public sealed class SqliteDatabaseInitializer(
    SqliteConnectionFactory connectionFactory,
    IAppLogger logger) : IDatabaseInitializer
{
    private const string InitialMigrationId = "0001_initial";
    private const string AttachmentDedupMigrationId = "0002_attachment_dedup_per_note";
    private const string SearchAndTagsMigrationId = "0003_search_and_tags";
    private const string HistoryContentMigrationId = "0004_history_content";
    private const string FirebaseSyncMigrationId = "0005_firebase_sync";
    private const string ReliableSyncMigrationId = "0006_reliable_sync";

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await connectionFactory.OpenAsync(cancellationToken);
        await using var transaction = connection.BeginTransaction();

        await using (var historyCommand = connection.CreateCommand())
        {
            historyCommand.Transaction = transaction;
            historyCommand.CommandText = """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    id TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
                """;
            await historyCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        if (!await MigrationExistsAsync(connection, transaction, InitialMigrationId, cancellationToken))
        {
            await ApplyInitialMigrationAsync(connection, transaction, cancellationToken);
            logger.Info($"Applied database migration {InitialMigrationId}.");
        }

        if (!await MigrationExistsAsync(connection, transaction, AttachmentDedupMigrationId, cancellationToken))
        {
            await ApplyAttachmentDedupMigrationAsync(connection, transaction, cancellationToken);
            logger.Info($"Applied database migration {AttachmentDedupMigrationId}.");
        }

        if (!await MigrationExistsAsync(connection, transaction, SearchAndTagsMigrationId, cancellationToken))
        {
            await ApplySearchAndTagsMigrationAsync(connection, transaction, cancellationToken);
            logger.Info($"Applied database migration {SearchAndTagsMigrationId}.");
        }

        if (!await MigrationExistsAsync(connection, transaction, HistoryContentMigrationId, cancellationToken))
        {
            await ApplyHistoryContentMigrationAsync(connection, transaction, cancellationToken);
            logger.Info($"Applied database migration {HistoryContentMigrationId}.");
        }

        if (!await MigrationExistsAsync(connection, transaction, FirebaseSyncMigrationId, cancellationToken))
        {
            await ApplyFirebaseSyncMigrationAsync(connection, transaction, cancellationToken);
            logger.Info($"Applied database migration {FirebaseSyncMigrationId}.");
        }

        if (!await MigrationExistsAsync(connection, transaction, ReliableSyncMigrationId, cancellationToken))
        {
            await ApplyReliableSyncMigrationAsync(connection, transaction, cancellationToken);
            logger.Info($"Applied database migration {ReliableSyncMigrationId}.");
        }

        await transaction.CommitAsync(cancellationToken);
    }

    private static async Task<bool> MigrationExistsAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction,
        string migrationId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT COUNT(*) FROM schema_migrations WHERE id = $id;";
        command.Parameters.AddWithValue("$id", migrationId);
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken)) > 0;
    }

    private static async Task ApplyInitialMigrationAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            CREATE TABLE notebooks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT NULL
            );

            CREATE TABLE notes (
                id TEXT PRIMARY KEY,
                notebook_id TEXT NULL REFERENCES notebooks(id),
                title TEXT NOT NULL,
                body_json TEXT NOT NULL,
                body_html TEXT NOT NULL,
                body_text TEXT NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                sync_state TEXT NOT NULL DEFAULT 'dirty'
            );

            CREATE INDEX ix_notes_updated_at ON notes(updated_at DESC);
            CREATE INDEX ix_notes_notebook_id ON notes(notebook_id);

            CREATE TABLE attachments (
                id TEXT PRIMARY KEY,
                note_id TEXT NOT NULL REFERENCES notes(id),
                relative_path TEXT NOT NULL,
                cloud_path TEXT NULL,
                mime_type TEXT NOT NULL,
                size INTEGER NOT NULL,
                width INTEGER NULL,
                height INTEGER NULL,
                sha256 TEXT NOT NULL,
                created_at TEXT NOT NULL,
                deleted_at TEXT NULL,
                sync_state TEXT NOT NULL DEFAULT 'dirty'
            );

            CREATE INDEX ix_attachments_note_id ON attachments(note_id);
            CREATE UNIQUE INDEX ux_attachments_sha256 ON attachments(sha256);

            CREATE TABLE note_versions (
                id TEXT PRIMARY KEY,
                note_id TEXT NOT NULL REFERENCES notes(id),
                version INTEGER NOT NULL,
                body_json TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                source_device_id TEXT NULL
            );

            CREATE UNIQUE INDEX ux_note_versions_note_version
                ON note_versions(note_id, version);

            CREATE TABLE sync_outbox (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                local_version INTEGER NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT NULL,
                last_error TEXT NULL
            );

            CREATE INDEX ix_sync_outbox_next_attempt_at ON sync_outbox(next_attempt_at);

            INSERT INTO schema_migrations (id, applied_at)
            VALUES ('0001_initial', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplyAttachmentDedupMigrationAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            DROP INDEX IF EXISTS ux_attachments_sha256;
            CREATE UNIQUE INDEX ux_attachments_note_sha256
                ON attachments(note_id, sha256);
            CREATE INDEX ix_attachments_deleted_at ON attachments(deleted_at);

            INSERT INTO schema_migrations (id, applied_at)
            VALUES ('0002_attachment_dedup_per_note', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplySearchAndTagsMigrationAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            CREATE VIRTUAL TABLE notes_fts USING fts5(
                note_id UNINDEXED,
                title,
                body_text,
                tokenize = 'trigram'
            );

            INSERT INTO notes_fts (note_id, title, body_text)
            SELECT id, title, body_text FROM notes;

            CREATE TRIGGER notes_fts_after_insert AFTER INSERT ON notes BEGIN
                INSERT INTO notes_fts (note_id, title, body_text)
                VALUES (new.id, new.title, new.body_text);
            END;

            CREATE TRIGGER notes_fts_after_update
            AFTER UPDATE OF title, body_text ON notes BEGIN
                DELETE FROM notes_fts WHERE note_id = old.id;
                INSERT INTO notes_fts (note_id, title, body_text)
                VALUES (new.id, new.title, new.body_text);
            END;

            CREATE TRIGGER notes_fts_after_delete AFTER DELETE ON notes BEGIN
                DELETE FROM notes_fts WHERE note_id = old.id;
            END;

            CREATE TABLE tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                created_at TEXT NOT NULL
            );

            CREATE TABLE note_tags (
                note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY (note_id, tag_id)
            );

            CREATE INDEX ix_note_tags_tag_id ON note_tags(tag_id, note_id);

            INSERT INTO schema_migrations (id, applied_at)
            VALUES ('0003_search_and_tags', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplyHistoryContentMigrationAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            ALTER TABLE note_versions ADD COLUMN body_html TEXT NOT NULL DEFAULT '';
            ALTER TABLE note_versions ADD COLUMN body_text TEXT NOT NULL DEFAULT '';
            CREATE INDEX ix_note_versions_note_created_at
                ON note_versions(note_id, created_at DESC);

            INSERT INTO schema_migrations (id, applied_at)
            VALUES ('0004_history_content', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplyFirebaseSyncMigrationAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            ALTER TABLE note_versions ADD COLUMN is_conflict INTEGER NOT NULL DEFAULT 0;

            CREATE TABLE sync_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            DELETE FROM sync_outbox
            WHERE rowid NOT IN (
                SELECT MAX(rowid) FROM sync_outbox GROUP BY entity_type, entity_id
            );
            CREATE UNIQUE INDEX ux_sync_outbox_entity
                ON sync_outbox(entity_type, entity_id);

            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT lower(hex(randomblob(16))), 'note', id, 'upsert', version, 0, NULL, NULL
            FROM notes
            WHERE 1 = 1
            ON CONFLICT(entity_type, entity_id) DO NOTHING;

            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT lower(hex(randomblob(16))), 'notebook', id, 'upsert', 1, 0, NULL, NULL
            FROM notebooks
            WHERE 1 = 1
            ON CONFLICT(entity_type, entity_id) DO NOTHING;

            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT lower(hex(randomblob(16))), 'attachment', id, 'upsert', 1, 0, NULL, NULL
            FROM attachments
            WHERE 1 = 1
            ON CONFLICT(entity_type, entity_id) DO NOTHING;

            INSERT INTO schema_migrations (id, applied_at)
            VALUES ('0005_firebase_sync', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task ApplyReliableSyncMigrationAsync(
        Microsoft.Data.Sqlite.SqliteConnection connection,
        Microsoft.Data.Sqlite.SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            ALTER TABLE notes ADD COLUMN purged_at TEXT NULL;
            ALTER TABLE notes ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;

            ALTER TABLE notebooks ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;

            ALTER TABLE attachments ADD COLUMN updated_at TEXT NULL;
            ALTER TABLE attachments ADD COLUMN purged_at TEXT NULL;
            ALTER TABLE attachments ADD COLUMN sync_revision INTEGER NOT NULL DEFAULT 1;
            UPDATE attachments SET updated_at = COALESCE(deleted_at, created_at);

            CREATE INDEX ix_notes_purged_at ON notes(purged_at);
            CREATE INDEX ix_attachments_purged_at ON attachments(purged_at);

            UPDATE sync_outbox
            SET local_version = CASE entity_type
                WHEN 'note' THEN COALESCE((
                    SELECT sync_revision FROM notes WHERE notes.id = sync_outbox.entity_id), local_version)
                WHEN 'notebook' THEN COALESCE((
                    SELECT sync_revision FROM notebooks WHERE notebooks.id = sync_outbox.entity_id), local_version)
                WHEN 'attachment' THEN COALESCE((
                    SELECT sync_revision FROM attachments WHERE attachments.id = sync_outbox.entity_id), local_version)
                ELSE local_version
            END;

            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT lower(hex(randomblob(16))), 'note', id, 'upsert', sync_revision, 0, NULL, NULL
            FROM notes
            WHERE 1 = 1
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                operation = 'upsert', local_version = excluded.local_version,
                attempt_count = 0, next_attempt_at = NULL, last_error = NULL;

            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT lower(hex(randomblob(16))), 'notebook', id, 'upsert', sync_revision, 0, NULL, NULL
            FROM notebooks
            WHERE 1 = 1
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                operation = 'upsert', local_version = excluded.local_version,
                attempt_count = 0, next_attempt_at = NULL, last_error = NULL;

            INSERT INTO sync_outbox (
                id, entity_type, entity_id, operation, local_version,
                attempt_count, next_attempt_at, last_error)
            SELECT lower(hex(randomblob(16))), 'attachment', id, 'upsert', sync_revision, 0, NULL, NULL
            FROM attachments
            WHERE 1 = 1
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                operation = 'upsert', local_version = excluded.local_version,
                attempt_count = 0, next_attempt_at = NULL, last_error = NULL;

            INSERT INTO schema_migrations (id, applied_at)
            VALUES ('0006_reliable_sync', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
            """;
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}

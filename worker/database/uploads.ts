import type { UploadMode, UploadSessionInfo, UploadState, UploadedPart } from '../../shared/api.ts';
import type { TierSlug } from '../../shared/constants.ts';

export interface UploadSessionRow {
  id: string;
  admin_id: number;
  film_id: number;
  film_slug: TierSlug;
  object_key: string;
  multipart_upload_id: string;
  mode: UploadMode;
  file_name: string;
  file_last_modified: number;
  mime_type: string;
  expected_size: number;
  part_size: number;
  total_parts: number;
  state: UploadState;
  video_id: string | null;
  created_at: string;
  expires_at: string;
}

interface PartRow {
  session_id: string;
  part_number: number;
  etag: string;
  size_bytes: number;
}

const SESSION_SELECT = `SELECT u.id, u.admin_id, u.film_id, f.slug AS film_slug, u.object_key,
  u.multipart_upload_id, u.mode, u.file_name, u.file_last_modified, u.mime_type, u.expected_size,
  u.part_size, u.total_parts, u.state, u.video_id, u.created_at, u.expires_at
  FROM upload_sessions u JOIN films f ON f.id = u.film_id`;

/** condition — фрагмент SQL после WHERE; значения передаются только через bind. */
export async function findSessionRows(
  db: D1Database,
  condition: string,
  values: (string | number)[],
): Promise<UploadSessionRow[]> {
  const { results } = await db
    .prepare(`${SESSION_SELECT} WHERE ${condition} ORDER BY u.created_at DESC`)
    .bind(...values)
    .all<UploadSessionRow>();
  return results;
}

export async function listPartRows(db: D1Database, sessionId: string): Promise<UploadedPart[]> {
  const { results } = await db
    .prepare(
      'SELECT session_id, part_number, etag, size_bytes FROM upload_parts WHERE session_id = ? ORDER BY part_number',
    )
    .bind(sessionId)
    .all<PartRow>();
  return results.map((row) => ({
    partNumber: row.part_number,
    etag: row.etag,
    sizeBytes: row.size_bytes,
  }));
}

export function toSessionInfo(row: UploadSessionRow, parts: UploadedPart[]): UploadSessionInfo {
  return {
    id: row.id,
    filmSlug: row.film_slug,
    fileName: row.file_name,
    fileSize: row.expected_size,
    fileLastModified: row.file_last_modified,
    mimeType: row.mime_type,
    partSize: row.part_size,
    totalParts: row.total_parts,
    state: row.state,
    mode: row.mode,
    uploadedParts: parts,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function toSessionInfos(db: D1Database, rows: UploadSessionRow[]): Promise<UploadSessionInfo[]> {
  return Promise.all(rows.map(async (row) => toSessionInfo(row, await listPartRows(db, row.id))));
}

/** Ожидаемый размер части: все равны part_size, последняя — остаток. */
export function expectedPartSize(row: UploadSessionRow, partNumber: number): number {
  if (partNumber < row.total_parts) return row.part_size;
  return row.expected_size - row.part_size * (row.total_parts - 1);
}

export async function upsertPart(db: D1Database, sessionId: string, part: UploadedPart): Promise<void> {
  await db
    .prepare(
      `INSERT INTO upload_parts (session_id, part_number, etag, size_bytes) VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, part_number) DO UPDATE SET etag = excluded.etag, size_bytes = excluded.size_bytes`,
    )
    .bind(sessionId, part.partNumber, part.etag, part.sizeBytes)
    .run();
}

/** Меняет состояние, только если текущее совпадает с from. true — строка действительно изменена. */
export async function transitionState(
  db: D1Database,
  sessionId: string,
  from: UploadState,
  to: UploadState,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE upload_sessions SET state = ? WHERE id = ? AND state = ?')
    .bind(to, sessionId, from)
    .run();
  return result.meta.changes === 1;
}

/** Помечает сессию прерванной и удаляет учёт её частей. */
export async function markAborted(db: D1Database, sessionId: string): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE upload_sessions SET state = 'aborted' WHERE id = ? AND state <> 'completed'")
      .bind(sessionId),
    db.prepare('DELETE FROM upload_parts WHERE session_id = ?').bind(sessionId),
  ]);
}

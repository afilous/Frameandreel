/**
 * EdgeSpark Server SDK Types
 *
 * This file is managed by `edgespark pull types`.
 * Run `edgespark pull types` to update to the latest version.
 *
 * DO NOT EDIT - changes will be overwritten on next pull.
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";

// =============================================================================
// CLIENT
// =============================================================================

/**
 * EdgeSpark Client - main SDK entry point
 * @template TSchema - Database schema from @generated
 * @example
 * export async function createApp(edgespark: Client<typeof tables>): Promise<Hono> {
 *   const app = new Hono();
 *   app.get('/api/posts', async (c) => {
 *     const userId = edgespark.auth.user!.id; // Guaranteed on /api/* routes
 *     const posts = await edgespark.db.select().from(tables.posts);
 *     return c.json({ posts });
 *   });
 *   return app;
 * }
 */
export interface Client<
  TSchema extends Record<string, unknown> = Record<string, never>
> {
  /** Drizzle D1 database client */
  db: DrizzleD1Database<TSchema>;

  /** Authentication client */
  auth: AuthClient;

  /** File storage client */
  storage: StorageClient;

  /** Access environment secrets */
  secret: SecretClient;

  /** Get current deployment environment */
  getDeployEnv(): DeploymentEnv;

  /** Request lifecycle context */
  ctx: ExecutionContext;
}

// =============================================================================
// AUTH
// =============================================================================

/**
 * Authenticated user identity (immutable for request duration)
 * @example const userId = edgespark.auth.user!.id;
 */
export interface User {
  /** User ID (use for DB foreign keys) */
  id: string;
  /** Email (null for anonymous or private OAuth like GitHub) */
  email: string | null;
  /** Display name (null for anonymous or some OAuth) */
  name: string | null;
  /** Avatar URL */
  image: string | null;
  /** Whether email is verified */
  emailVerified: boolean;
  /** Whether user is anonymous (guest, not registered) */
  isAnonymous: boolean;
  /** Account creation timestamp */
  createdAt: Date;
}

/**
 * Authentication client - framework enforces auth based on path conventions
 *
 * Path conventions:
 * - /api/* → Login required, auth.user guaranteed
 * - /api/public/* → Login optional, auth.user if logged in (else null)
 * - /api/webhooks/* → No auth check, handle verification yourself
 *
 * @example
 * // On /api/* routes, user is guaranteed
 * app.get('/api/profile', (c) => {
 *   const user = edgespark.auth.user!; // Safe, framework ensures auth
 *   return c.json({ id: user.id, email: user.email });
 * });
 *
 * // On /api/public/* routes, check if authenticated
 * app.get('/api/public/posts', (c) => {
 *   if (edgespark.auth.isAuthenticated()) {
 *     // Show personalized content
 *   }
 * });
 */
export interface AuthClient {
  /** Current user (immutable for request). Guaranteed on /api/*, available if logged in on /api/public/*, null on /api/webhooks/* */
  readonly user: User | null;
  /** Returns true if user is authenticated */
  isAuthenticated(): boolean;
}

// =============================================================================
// SECRET
// =============================================================================

export interface SecretClient {
  /**
   * Get secret by name
   * @example const key = edgespark.secret.get('API_KEY');
   */
  get(name: string): string | null;
}

// =============================================================================
// COMMON
// =============================================================================

export type DeploymentEnv = "production" | "staging";

/**
 * Request lifecycle context
 */
export interface ExecutionContext {
  /**
   * Run task in background without blocking response (limit: 30s after response ends).
   * @example edgespark.ctx.runInBackground(sendAnalytics());
   */
  runInBackground(promise: Promise<unknown>): void;
}

// =============================================================================
// STORAGE
// =============================================================================

/** Bucket definition from @generated */
export interface BucketDef {
  readonly bucket_name: string;
  readonly description: string;
}

export interface StorageClient {
  /**
   * Create S3 URI for storing file references in database. Not a download URL.
   * @returns S3 URI (e.g., "s3://avatars/user-1.jpg") - use createPresignedGetUrl() for client download links
   * @example const uri = edgespark.storage.toS3Uri(buckets.avatars, 'user-1.jpg');
   */
  toS3Uri(bucket: BucketDef, path: string): string;

  /**
   * Parse S3 URI back to bucket + path. Use to resolve file references stored in database.
   * @example const { bucket, path } = edgespark.storage.fromS3Uri(user.avatarUri);
   */
  fromS3Uri(uri: string): { bucket: BucketDef; path: string };

  /**
   * Select bucket for operations
   * @example await edgespark.storage.from(buckets.uploads).put('file.txt', buffer);
   */
  from(bucket: BucketDef): BucketClient;
}

/**
 * Options for listing files in a bucket
 *
 * @example
 * // Setup: import buckets from @generated, get BucketClient via from()
 * import { buckets } from '@generated';
 * const bucket = edgespark.storage.from(buckets.files); // BucketDef, not string!
 *
 * // List all files
 * await bucket.list()
 *
 * // Filter by prefix (e.g., get all files for a user)
 * await bucket.list({ prefix: 'user-123/' })
 *
 * // Pagination
 * const page1 = await bucket.list({ limit: 100 })
 * if (page1.hasMore) {
 *   const page2 = await bucket.list({ limit: 100, cursor: page1.cursor })
 * }
 *
 * // Folder-like listing with delimiter
 * // Use delimiter: '/' to group files into "folders"
 * const { objects, delimitedPrefixes } = await bucket.list({
 *   prefix: 'documents/',
 *   delimiter: '/'
 * })
 * // objects = files directly in documents/ (e.g., 'documents/readme.txt')
 * // delimitedPrefixes = subfolders (e.g., ['documents/api/', 'documents/guides/'])
 */
export interface StorageListOptions {
  /** Maximum number of files to return (default: 1000, max: 1000) */
  limit?: number;
  /** Only return files whose keys start with this prefix (e.g., 'user-123/' or 'images/') */
  prefix?: string;
  /** Pagination token from previous result.cursor. Use to get next page of results */
  cursor?: string;
  /**
   * Character to group keys by (usually '/'). When set, keys containing the delimiter
   * after the prefix are grouped and returned in result.delimitedPrefixes instead of result.objects.
   * This enables folder-like browsing of storage.
   */
  delimiter?: string;
}

export interface BucketClient {
  /**
   * Upload file (<100MB). Use createPresignedPutUrl for large files.
   * @example
   * import { buckets } from '@generated';
   * const bucket = edgespark.storage.from(buckets.avatars);
   * await bucket.put('photo.jpg', buffer, { contentType: 'image/jpeg' });
   */
  put(
    path: string,
    file: ArrayBuffer,
    options?: StorageHttpMetadata
  ): Promise<{ success: boolean }>;

  /**
   * Download file. Returns null if not found.
   * @example
   * import { buckets } from '@generated';
   * const bucket = edgespark.storage.from(buckets.documents);
   * const file = await bucket.get('doc.pdf');
   * if (file) {
   *   // file.body is ArrayBuffer, file.metadata has size and httpMetadata
   * }
   */
  get(path: string): Promise<StorageObject | null>;

  /**
   * Get metadata only (no body). Faster than get() for existence checks.
   * @example
   * import { buckets } from '@generated';
   * const bucket = edgespark.storage.from(buckets.uploads);
   * const meta = await bucket.head('file.txt');
   * if (meta) {
   *   console.log(meta.size, meta.contentType);
   * }
   */
  head(path: string): Promise<StorageObjectMetadata | null>;

  /**
   * List files with optional filtering and pagination
   *
   * @param options - See {@link StorageListOptions} for all options
   * @returns {@link StorageListResult} with objects, hasMore, cursor, delimitedPrefixes
   *
   * @example
   * // First: get BucketClient from BucketDef (not string!)
   * import { buckets } from '@generated';
   * const bucket = edgespark.storage.from(buckets.uploads);
   *
   * // List user's files
   * const { objects } = await bucket.list({ prefix: 'user-123/' })
   *
   * // Paginated listing
   * let cursor: string | undefined
   * do {
   *   const result = await bucket.list({ limit: 100, cursor })
   *   cursor = result.hasMore ? result.cursor : undefined
   * } while (cursor)
   *
   * // Folder browser (delimiter returns subfolders in delimitedPrefixes)
   * const { objects, delimitedPrefixes } = await bucket.list({
   *   prefix: 'photos/',
   *   delimiter: '/'
   * })
   */
  list(options?: StorageListOptions): Promise<StorageListResult>;

  /**
   * Delete file(s). Supports bulk delete up to 1000 paths.
   * @example
   * import { buckets } from '@generated';
   * const bucket = edgespark.storage.from(buckets.temp);
   * // Single file
   * await bucket.delete('old-file.txt');
   * // Bulk delete
   * await bucket.delete(['file1.jpg', 'file2.jpg', 'file3.jpg']);
   */
  delete(paths: string | string[]): Promise<{ success: boolean }>;

  /**
   * Generate presigned upload URL for direct client uploads
   * @example
   * import { buckets } from '@generated';
   * const bucket = edgespark.storage.from(buckets.videos);
   * const { uploadUrl, expiresAt } = await bucket.createPresignedPutUrl('video.mp4', 3600);
   * // Return uploadUrl to client, client uploads directly via PUT request
   */
  createPresignedPutUrl(
    path: string,
    expiresInSecs?: number,
    options?: StorageHttpMetadata
  ): Promise<{ uploadUrl: string; path: string; expiresAt: Date }>;

  /**
   * Generate presigned download URL for direct client downloads
   * @example
   * import { buckets } from '@generated';
   * const bucket = edgespark.storage.from(buckets.videos);
   * const { downloadUrl, expiresAt } = await bucket.createPresignedGetUrl('video.mp4', 3600);
   * // Return downloadUrl to client for direct download
   */
  createPresignedGetUrl(
    path: string,
    expiresInSecs?: number
  ): Promise<{ downloadUrl: string; path: string; expiresAt: Date }>;
}

// =============================================================================
// STORAGE TYPES
// =============================================================================

export interface StorageHttpMetadata {
  contentType?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
}

export interface StorageObjectMetadata extends StorageHttpMetadata {
  size: number;
}

export interface StorageObject {
  body: ArrayBuffer;
  metadata: StorageObjectMetadata;
}

/** File info returned in StorageListResult.objects */
export interface StorageFileInfo {
  /** Full path of the file (e.g., 'user-123/photos/image.jpg') */
  key: string;
  /** File size in bytes */
  size: number;
  /** Upload timestamp */
  uploaded: Date;
}

/**
 * Result from bucket.list() operation
 *
 * @example
 * import { buckets } from '@generated';
 * const bucket = edgespark.storage.from(buckets.files); // BucketDef, not string!
 *
 * const result = await bucket.list({ prefix: 'user-123/', delimiter: '/' })
 *
 * // Files matching the query
 * result.objects.forEach(file => {
 *   console.log(file.key)      // 'user-123/photo.jpg'
 *   console.log(file.size)     // 1024 (bytes)
 *   console.log(file.uploaded) // Date object
 * })
 *
 * // Pagination
 * if (result.hasMore) {
 *   const nextPage = await bucket.list({ cursor: result.cursor })
 * }
 *
 * // Subfolders (only when delimiter is used)
 * result.delimitedPrefixes // ['user-123/photos/', 'user-123/documents/']
 */
export interface StorageListResult {
  /** Array of file objects matching the query */
  objects: StorageFileInfo[];
  /** True if more results available. Use cursor to fetch next page */
  hasMore: boolean;
  /** Pagination token. Pass to next list() call to get more results. Only present when hasMore is true */
  cursor?: string;
  /** Common prefixes (subfolders) when delimiter option is used. Empty array if no delimiter specified */
  delimitedPrefixes: string[];
}
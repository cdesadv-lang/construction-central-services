// Storage abstraction for attachments.
//   STORAGE_DRIVER=local           -> LocalDiskStorage under UPLOAD_DIR
//   STORAGE_DRIVER=s3              -> S3Storage (AWS S3 or any S3-compatible service: MinIO, Cloudflare R2, Wasabi, DO Spaces…)
//   STORAGE_DRIVER unset           -> s3 when S3_BUCKET is set, otherwise local
// On hosts with an ephemeral filesystem (Vercel, or EPHEMERAL_FS=true) local uploads are refused unless
// ALLOW_EPHEMERAL_UPLOADS=true, because files would disappear on the next deploy / instance.
// Every Document row records the driver that stored it (Document.storageDriver), so switching drivers keeps old files readable.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type DriverName = "local" | "s3";
type Env = Record<string, string | undefined>;

export interface StorageDriver {
  readonly name: DriverName;
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  check(): Promise<void>;
}

export class LocalDiskStorage implements StorageDriver {
  readonly name = "local" as const;
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data);
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async remove(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
  async check() {
    await fs.mkdir(this.root, { recursive: true });
    await fs.access(this.root, fs.constants.W_OK);
  }
}

export interface S3Config {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  prefix?: string;
}

export class S3Storage implements StorageDriver {
  readonly name = "s3" as const;
  private client: S3Client;
  constructor(private cfg: S3Config) {
    if (!cfg.bucket) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    silenceSdkNodeWarning();
    this.client = new S3Client({
      region: cfg.region || "us-east-1",
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle ?? !!cfg.endpoint,
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
    });
  }
  private k(key: string) {
    if (key.includes("..")) throw new Error("Invalid storage key");
    return (this.cfg.prefix ? this.cfg.prefix.replace(/\/+$/, "") + "/" : "") + key;
  }
  async put(key: string, data: Buffer, contentType?: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key), Body: data, ContentType: contentType, ServerSideEncryption: process.env.S3_SSE === "AES256" ? "AES256" : undefined }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
    if (!r.Body) throw new Error("Empty object");
    return Buffer.from(await r.Body.transformToByteArray());
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.k(key) }));
  }
  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
  }
}

/**
 * AWS SDK v3 releases after early January 2027 require Node >= 22 and print a NodeVersionSupportWarning on older
 * runtimes. Production images/hosts run Node 22 (Dockerfile, .nvmrc); on Node 20 the warning is informational
 * only, so it is silenced unless the operator explicitly set AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED.
 */
export function silenceSdkNodeWarning(version: string = process.version, env: Env = process.env) {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  if (major < 22 && env.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED === undefined) env.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED = "true";
}

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  return {
    bucket: env.S3_BUCKET ?? "",
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === "true" : undefined,
    prefix: env.S3_PREFIX,
  };
}

const drivers = new Map<DriverName, StorageDriver>();

/** Driver by name (lazily constructed from env). */
export function driverFor(name: string | null | undefined): StorageDriver {
  const n: DriverName = name === "s3" ? "s3" : "local";
  let d = drivers.get(n);
  if (!d) {
    d = n === "s3" ? new S3Storage(s3ConfigFromEnv()) : new LocalDiskStorage(process.env.UPLOAD_DIR || "./storage/uploads");
    drivers.set(n, d);
  }
  return d;
}

/** Driver name for new uploads: STORAGE_DRIVER, else s3 when S3_BUCKET is configured, else local. */
export function activeDriverName(env: Env = process.env): DriverName {
  const explicit = env.STORAGE_DRIVER?.trim().toLowerCase();
  if (explicit === "s3" || explicit === "local") return explicit;
  return env.S3_BUCKET?.trim() ? "s3" : "local";
}

/** Explains why local storage is unsafe on this host (ephemeral filesystem), or null. */
export function storagePolicyProblem(env: Env = process.env): string | null {
  if (activeDriverName(env) !== "local" || env.ALLOW_EPHEMERAL_UPLOADS === "true") return null;
  if (env.VERCEL || env.EPHEMERAL_FS === "true")
    return "Attachments need persistent storage on this host (its filesystem is ephemeral): set S3_BUCKET (and S3_* credentials) or STORAGE_DRIVER=s3";
  return null;
}

/** Driver used for new uploads. */
export function activeStorage(): StorageDriver {
  return driverFor(activeDriverName());
}

export function makeKey(companyId: string, fileName: string) {
  const safe = fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-120);
  const d = new Date();
  return `${companyId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safe}`;
}

export const ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/csv",
  "text/plain",
];

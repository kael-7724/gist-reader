declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MAIMEMO_ENCRYPTION_KEY?: string;
  }
}

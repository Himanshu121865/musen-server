import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  databaseUrl: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/chat",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  uploadDir: process.env.UPLOAD_DIR || "./uploads",
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "52428800", 10),
  rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS || "60", 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  storageBackend: (process.env.STORAGE_BACKEND || "local") as "local" | "s3",
  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Region: process.env.S3_REGION || "auto",
  s3Bucket: process.env.S3_BUCKET || "chat-uploads",
  s3AccessKey: process.env.S3_ACCESS_KEY || "",
  s3SecretKey: process.env.S3_SECRET_KEY || "",
  shutdownTimeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "10000", 10),
};

const REQUIRED = ["JWT_SECRET"] as const;

export function validateConfig(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (config.jwtSecret === "dev-secret-change-in-production") {
    console.warn("WARNING: JWT_SECRET is set to default dev value. Change it for production.");
  }
  if (config.port < 1 || config.port > 65535) {
    console.error("PORT must be between 1 and 65535");
    process.exit(1);
  }
  if (config.maxFileSize < 1024 || config.maxFileSize > 104857600) {
    console.error("MAX_FILE_SIZE must be between 1KB and 100MB");
    process.exit(1);
  }
  if (config.storageBackend === "s3" && (!config.s3Endpoint || !config.s3Bucket)) {
    console.error("S3_ENDPOINT and S3_BUCKET required when STORAGE_BACKEND=s3");
    process.exit(1);
  }
  console.log("Config validation passed");
}

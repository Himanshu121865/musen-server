import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { randomBytes } from "crypto";
import { extname } from "path";
import type { Storage } from "./index";
import { config } from "../config";

export class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;
  private endpoint: string;

  constructor() {
    this.bucket = config.s3Bucket;
    this.endpoint = config.s3Endpoint;
    this.client = new S3Client({
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      credentials: {
        accessKeyId: config.s3AccessKey,
        secretAccessKey: config.s3SecretKey,
      },
      forcePathStyle: true,
    });
  }

  private generateFilename(original: string): string {
    const ext = extname(original);
    const random = randomBytes(8).toString("hex");
    return `${Date.now()}-${random}${ext}`;
  }

  async save(_original: string, data: Buffer): Promise<string> {
    const filename = this.generateFilename(_original);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: filename,
        Body: data,
      }),
    );
    return filename;
  }

  async get(filename: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: filename }),
      );
      return Buffer.from(await result.Body!.transformToByteArray());
    } catch {
      return null;
    }
  }

  async delete(filename: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: filename }),
    );
  }

  async exists(filename: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: filename }),
      );
      return true;
    } catch {
      return false;
    }
  }

  getUrl(filename: string): string {
    if (this.endpoint.includes("tigris.dev")) {
      return `/uploads/${filename}`;
    }
    return `${this.endpoint}/${this.bucket}/${filename}`;
  }
}

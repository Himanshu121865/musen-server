import { config } from "../config";
import { LocalFileStorage } from "./local";
import { S3Storage } from "./s3";

export interface Storage {
  save(filename: string, data: Buffer): Promise<string>;
  get(filename: string): Promise<Buffer | null>;
  delete(filename: string): Promise<void>;
  exists(filename: string): Promise<boolean>;
  getUrl(filename: string): string;
}

export function createStorage(): Storage {
  if (config.storageBackend === "s3") {
    return new S3Storage();
  }
  return new LocalFileStorage();
}

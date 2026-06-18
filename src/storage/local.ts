import { existsSync, mkdirSync, unlinkSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join, extname } from "path";
import { randomBytes } from "crypto";
import type { Storage } from "./index";
import { config } from "../config";

export class LocalFileStorage implements Storage {
  private dir: string;

  constructor() {
    this.dir = config.uploadDir;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  private generateFilename(original: string): string {
    const ext = extname(original);
    const random = randomBytes(8).toString("hex");
    return `${Date.now()}-${random}${ext}`;
  }

  async save(_original: string, data: Buffer): Promise<string> {
    const filename = this.generateFilename(_original);
    const filepath = join(this.dir, filename);
    await writeFile(filepath, data);
    return filename;
  }

  async get(filename: string): Promise<Buffer | null> {
    const filepath = join(this.dir, filename);
    try {
      return await readFile(filepath);
    } catch {
      return null;
    }
  }

  async delete(filename: string): Promise<void> {
    const filepath = join(this.dir, filename);
    if (existsSync(filepath)) {
      unlinkSync(filepath);
    }
  }

  async exists(filename: string): Promise<boolean> {
    return existsSync(join(this.dir, filename));
  }

  getUrl(filename: string): string {
    return `/uploads/${filename}`;
  }
}

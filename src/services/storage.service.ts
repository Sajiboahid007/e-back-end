import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

export interface IStorageService {
  saveFile(fileBuffer: Buffer, fileName: string, subDir?: string): Promise<string>;
  deleteFile(filePath: string): Promise<boolean>;
  getUrl(filePath: string): string;
}

export class LocalStorageService implements IStorageService {
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(process.cwd(), config.uploadDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async saveFile(fileBuffer: Buffer, fileName: string, subDir: string = 'products'): Promise<string> {
    const targetDir = path.join(this.baseDir, subDir);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const relativePath = path.join(subDir, fileName).replace(/\\/g, '/');
    const absolutePath = path.join(this.baseDir, relativePath);

    await fs.promises.writeFile(absolutePath, fileBuffer);
    return `/uploads/${relativePath}`;
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const cleanPath = filePath.replace(/^\/uploads\//, '');
      const absolutePath = path.join(this.baseDir, cleanPath);
      if (fs.existsSync(absolutePath)) {
        await fs.promises.unlink(absolutePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  getUrl(filePath: string): string {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    return `${config.baseUrl}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
  }
}

export const storageService: IStorageService = new LocalStorageService();

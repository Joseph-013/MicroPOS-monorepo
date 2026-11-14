import fs from 'node:fs';
import path from 'node:path';
import { MAX_LOGO_BYTES, type SaveLogoResult } from '@micropos/core';

/** A picture that was read and scaled down to fit the widest paper, as PNG. */
export interface DecodedLogo {
  png: Buffer;
}

/**
 * The shop logo file. A picture is checked, scaled and stored as a PNG in one known place, so a bad or huge upload
 * can never break printing. The pictures themselves are read by `decode` (Electron's image support in the app, a
 * stand-in in tests).
 */
export class LogoStore {
  constructor(
    private readonly file: () => string,
    private readonly decode: (bytes: Uint8Array) => DecodedLogo | null,
  ) {}

  has(): boolean {
    return fs.existsSync(this.file());
  }

  /** The stored PNG, or null when there is none. */
  read(): Buffer | null {
    try {
      return fs.readFileSync(this.file());
    } catch {
      return null;
    }
  }

  save(bytes: unknown): SaveLogoResult {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { ok: false, error: 'Choose a picture' };
    if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: `The picture is too large (the limit is ${MAX_LOGO_BYTES / 1024 / 1024} MB)` };
    const decoded = this.decode(bytes);
    if (!decoded) return { ok: false, error: 'That file is not a picture the printer can use (use PNG or JPEG)' };
    // Written beside the real file and moved into place, so a failure half-way leaves the old logo as it was.
    const target = this.file();
    const temporary = `${target}.tmp`;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(temporary, decoded.png);
      fs.renameSync(temporary, target);
    } catch (error) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // Nothing to clean up (the folder itself could not be made).
      }
      return { ok: false, error: `The logo could not be saved (${error instanceof Error ? error.message : String(error)})` };
    }
    return { ok: true, dataUrl: `data:image/png;base64,${decoded.png.toString('base64')}` };
  }

  remove(): void {
    fs.rmSync(this.file(), { force: true });
  }

  dataUrl(): string | null {
    const png = this.read();
    return png ? `data:image/png;base64,${png.toString('base64')}` : null;
  }
}

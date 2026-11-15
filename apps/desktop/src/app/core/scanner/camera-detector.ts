import { isLanDevice } from '../api/remote-api';

/** What a camera is asked to read: the retail codes on products plus the QR code on a receipt. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix'] as const;

export interface CodeDetector {
  /** The text of the first code in the frame, or undefined when there is none. */
  detect(frame: HTMLVideoElement): Promise<string | undefined>;
}

/** A device can scan with its camera when it is a paired phone or tablet (the till has its USB scanner) and the browser allows camera access (HTTPS). */
export const cameraScanSupported = (): boolean => isLanDevice() && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

/**
 * The browser's own detector where it has one (Chrome on Android), otherwise the same API in WebAssembly (`barcode-detector`,
 * so Safari and Firefox work too). The module is fetched from the till itself (`zxing/zxing_reader.wasm`, copied into the build),
 * never from the internet, and only when the camera is first opened.
 */
export async function createCodeDetector(): Promise<CodeDetector> {
  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill');
  const native = (globalThis as { BarcodeDetector?: typeof BarcodeDetector & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  let Detector: typeof BarcodeDetector = BarcodeDetector;
  if (native) {
    const supported: readonly string[] = (await native.getSupportedFormats?.().catch(() => [] as string[])) ?? [];
    if (supported.includes('ean_13') && supported.includes('qr_code')) Detector = native;
  }
  if (Detector === BarcodeDetector) {
    setZXingModuleOverrides({
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? new URL('zxing/zxing_reader.wasm', document.baseURI).href : prefix + path),
    });
  }
  const detector = new Detector({ formats: [...FORMATS] });
  return {
    async detect(frame) {
      const found = await detector.detect(frame);
      return found[0]?.rawValue || undefined;
    },
  };
}

import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { createCodeDetector, type CodeDetector } from './camera-detector';
import { ScannerService } from './scanner.service';

/** The same code in front of the camera is not scanned again until this long has passed (or another code was seen). */
const REPEAT_MS = 1500;
/** The frame is looked at this often; a faster loop only drains a phone's battery. */
const FRAME_MS = 120;

/**
 * The camera view of the barcode scanner (shown in a dialog of its own, or inside the dialog that wants scans), for phones and tablets that have no scanner hardware. Every code it reads goes to the
 * scanner service exactly as a USB scan does, so whatever page or dialog has claimed the scanner (Checkout, the product
 * form, receiving stock...) gets it with no code of its own. It stays on for the next product.
 */
@Component({
  selector: 'app-camera-scan-panel',
  host: { class: 'flex min-w-0 flex-col gap-1' },
  template: `
    <div class="bg-muted relative mx-auto flex aspect-[4/3] max-h-[40vh] w-full min-w-0 items-center justify-center overflow-hidden">
      <video #video class="size-full object-cover" playsinline muted autoplay aria-label="Camera"></video>
      @if (status()) {
        <p class="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-sm" role="status">{{ status() }}</p>
      }
      <div class="border-primary pointer-events-none absolute inset-x-[12%] inset-y-[30%] border-2" aria-hidden="true"></div>
    </div>

    <p class="flex h-5 min-w-0 items-center justify-center gap-2 text-sm" aria-live="polite">
      @if (last()) {
        <span class="text-muted-foreground shrink-0">Scanned</span> <span class="min-w-0 truncate font-medium">{{ last() }}</span>
      }
    </p>

  `,
})
export class CameraScanPanel {
  private readonly scanner = inject(ScannerService);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | undefined;
  private stopped = false;
  private lastCode = '';
  private lastAt = 0;

  protected readonly status = signal('Starting the camera...');
  protected readonly last = signal('');

  /** Made when the camera is opened (by a press, which browsers require before they allow sound). */
  private readonly audio = typeof AudioContext === 'undefined' ? undefined : new AudioContext();

  constructor() {
    void this.audio?.resume().catch(() => undefined);
    inject(DestroyRef).onDestroy(() => {
      void this.audio?.close().catch(() => undefined);
      this.stopped = true;
      this.stream?.getTracks().forEach((track) => track.stop());
    });
    queueMicrotask(() => void this.start());
  }

  private async start(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } });
      if (this.stopped) return stream.getTracks().forEach((track) => track.stop());
      this.stream = stream;
      const video = this.video().nativeElement;
      video.srcObject = stream;
      await video.play();
      const detector = await createCodeDetector();
      this.status.set('');
      void this.loop(video, detector);
    } catch (error) {
      this.status.set(this.describe(error));
    }
  }

  private async loop(video: HTMLVideoElement, detector: CodeDetector): Promise<void> {
    while (!this.stopped) {
      await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
      if (this.stopped || video.readyState < 2 || document.hidden) continue;
      try {
        const code = await detector.detect(video);
        if (code) this.found(code);
      } catch {
        // A frame that cannot be read is skipped.
      }
    }
  }

  private found(code: string): void {
    const now = Date.now();
    if (code === this.lastCode && now - this.lastAt < REPEAT_MS) return;
    this.lastCode = code;
    this.lastAt = now;
    this.last.set(code);
    navigator.vibrate?.(60);
    this.beep();
    this.scanner.receive(code);
  }

  /** A short, soft sine tone to say the code was read. */
  private beep(): void {
    const audio = this.audio;
    if (!audio || audio.state !== 'running') return;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    const now = audio.currentTime;
    tone.type = 'sine';
    tone.frequency.value = 1000;
    // Ramp in and out so the tone does not click.
    volume.gain.setValueAtTime(0, now);
    volume.gain.linearRampToValueAtTime(0.25, now + 0.01);
    volume.gain.linearRampToValueAtTime(0, now + 0.12);
    tone.connect(volume).connect(audio.destination);
    tone.start(now);
    tone.stop(now + 0.13);
  }

  private describe(error: unknown): string {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was refused. Allow it for this site in the browser settings and try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'This device has no camera.';
    if (name === 'NotReadableError') return 'The camera is in use by another app.';
    return 'The camera could not be started.';
  }
}

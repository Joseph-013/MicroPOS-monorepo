import { Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

/** A QR code as an SVG: black modules on white with the quiet zone the standard asks for (so it scans in any theme). */
@Component({
  selector: 'app-qr-code',
  template: `
    <svg [attr.viewBox]="'0 0 ' + size() + ' ' + size()" role="img" [attr.aria-label]="label()" class="block size-full" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="#fff" />
      <path [attr.d]="path()" fill="#000" />
    </svg>
  `,
  host: { class: 'block' },
})
export class QrCode {
  readonly text = input.required<string>();
  readonly label = input('QR code');
  private readonly quiet = 4;
  private readonly matrix = computed(() => {
    const qr = qrcode(0, 'M');
    qr.addData(this.text());
    qr.make();
    const n = qr.getModuleCount();
    return { n, dark: (r: number, c: number): boolean => qr.isDark(r, c) };
  });
  protected readonly size = computed(() => this.matrix().n + 2 * this.quiet);
  protected readonly path = computed(() => {
    const { n, dark } = this.matrix();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) d += `M${c + this.quiet} ${r + this.quiet}h1v1h-1z`;
    return d;
  });
}

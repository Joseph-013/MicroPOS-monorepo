import { Menu, nativeImage, Tray } from 'electron';

/**
 * The icon in the system tray (the notification area beside the Windows taskbar clock) that stays while the main
 * window is hidden. Click it, or choose Open, to bring the window back; Quit really closes the app.
 */
export class TrayIcon {
  private tray: Tray | undefined;

  constructor(
    private readonly iconFile: () => string,
    private readonly open: () => void,
    private readonly quit: () => void,
  ) {}

  get shown(): boolean {
    return !!this.tray;
  }

  show(): void {
    if (this.tray) return;
    const tray = new Tray(nativeImage.createFromPath(this.iconFile()).resize({ width: 16, height: 16 }));
    tray.setToolTip('MicroPOS');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open MicroPOS', click: this.open }, { type: 'separator' }, { label: 'Quit', click: this.quit }]));
    tray.on('click', this.open);
    this.tray = tray;
  }

  hide(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}

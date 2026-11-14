import { Component, inject, signal } from '@angular/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmContextMenuImports } from '@spartan-ng/helm/context-menu';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmRadioGroupImports } from '@spartan-ng/helm/radio-group';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';
import { provideIcons } from '@ng-icons/core';
import { lucideArchive, lucideFlag, lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { BannerService } from '../core/banner';
import { ScanInputDirective, ScannerClaimDirective, ScannerService } from '../core/scanner';

/** Static style showcase of the themed components (no app logic). */
@Component({
  imports: [
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmContextMenuImports,
    HlmDialogImports,
    HlmDropdownMenuImports,
    HlmInputImports,
    HlmLabelImports,
    HlmRadioGroupImports,
    HlmSelectImports,
    HlmSwitchImports,
    HlmTableImports,
    HlmTabsImports,
    HlmTextareaImports,
    ScanInputDirective,
    ScannerClaimDirective,
  ],
  providers: [provideIcons({ lucideArchive, lucideFlag, lucidePencil, lucideTrash2 })],
  templateUrl: './components.html',
})
export class ComponentsPage {
  private readonly banner = inject(BannerService);
  protected showTimed(): void {
    this.banner.success('Saved');
  }
  protected showNotice(dismissible: boolean): void {
    this.banner.warning('System update at 22:00. Finish open orders.', {
      duration: 'persistent',
      key: 'demo-update',
      dismissible,
    });
  }
  protected removeNotice(): void {
    this.banner.remove('demo-update');
  }

  protected readonly scanner = inject(ScannerService);
  protected readonly claimed = signal(false);
  protected readonly claimedScan = signal('');
  protected readonly payment = signal<string | undefined>(undefined);
  protected readonly printReceipt = signal(true);
  protected readonly taxExempt = signal(false);
  protected readonly receiptType = signal('print');
}

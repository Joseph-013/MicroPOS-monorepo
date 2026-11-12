import { Component } from '@angular/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmTableImports } from '@spartan-ng/helm/table';

/** Static style showcase of the themed components (no app logic). */
@Component({
  imports: [HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmInputImports, HlmLabelImports, HlmTableImports],
  templateUrl: './components.html',
})
export class ComponentsPage {}

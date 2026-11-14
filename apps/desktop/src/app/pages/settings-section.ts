import { computed, Directive, inject, input, signal, Component, DestroyRef, Service } from '@angular/core';
import { HlmAccordionImports } from '@spartan-ng/helm/accordion';

/** Lower case, accents dropped, so "Écran" is found by "ecran". */
const normalize = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** True when every word of the search is somewhere in the text (an empty search matches everything). */
export const matchesSearch = (text: string, query: string): boolean => normalize(query).split(/\s+/).filter(Boolean).every((word) => normalize(text).includes(word));

/** The search box's text, shared by the sections and settings of the Settings page (the page clears it when it closes). */
@Service()
export class SettingsSearch {
  readonly query = signal('');
  readonly active = computed(() => this.query().trim() !== '');
  private readonly sections = signal<readonly SettingsSection[]>([]);
  /** False while searching when nothing matches (the page then says so). */
  readonly anyShown = computed(() => !this.active() || this.sections().some((s) => s.visible()));

  add(section: SettingsSection): void {
    this.sections.update((list) => [...list, section]);
  }
  remove(section: SettingsSection): void {
    this.sections.update((list) => list.filter((s) => s !== section));
  }
}

/**
 * One section of the Settings accordion. With nothing typed in the search it opens and closes like any accordion item.
 * While searching it shows only if its title or one of its settings matches, and is held open so what matched can be
 * seen; a section whose title matches shows all its settings, otherwise only the matching ones show.
 */
@Component({
  selector: 'app-settings-section',
  imports: [HlmAccordionImports],
  template: `
    @if (visible()) {
      <hlm-accordion-item [isOpened]="open()" (openedChange)="toggled($event)">
        <hlm-accordion-trigger triggerClass="px-4 py-3 text-base">{{ title() }}</hlm-accordion-trigger>
        <hlm-accordion-content>
          <div class="grid gap-1 px-4 pb-2"><ng-content /></div>
        </hlm-accordion-content>
      </hlm-accordion-item>
    }
  `,
  host: { class: 'contents' },
})
export class SettingsSection {
  readonly title = input.required<string>();
  /** Open when the page first shows (the user's own opening and closing is kept while the page lives). */
  readonly startOpen = input(false);

  private readonly search = inject(SettingsSearch);
  private readonly rows = signal<readonly SettingRow[]>([]);
  private readonly userOpen = signal<boolean | null>(null);

  /** Whether the title itself matches the search. */
  readonly titleMatches = computed(() => matchesSearch(this.title(), this.search.query()));
  readonly visible = computed(() => !this.search.active() || this.titleMatches() || this.rows().some((r) => r.matches()));
  protected readonly open = computed(() => this.search.active() || (this.userOpen() ?? this.startOpen()));

  constructor() {
    this.search.add(this);
    inject(DestroyRef).onDestroy(() => this.search.remove(this));
  }

  register(row: SettingRow): void {
    this.rows.update((rows) => [...rows, row]);
  }
  unregister(row: SettingRow): void {
    this.rows.update((rows) => rows.filter((r) => r !== row));
  }

  protected toggled(opened: boolean): void {
    if (!this.search.active()) this.userOpen.set(opened); // while searching the section is held open, so that is not the user's choice
  }
}

/**
 * Marks one setting (a row, or a block of fields) inside a section: `<div [appSetting]="'On-screen keyboard'" settingKeywords="touch keypad">`.
 * Its label and keywords are what the search looks at; while searching it hides unless it matches (or its section's title does).
 */
@Directive({ selector: '[appSetting]', host: { '[hidden]': 'hidden()' } })
export class SettingRow {
  readonly label = input.required<string>({ alias: 'appSetting' });
  readonly keywords = input('', { alias: 'settingKeywords' });

  private readonly search = inject(SettingsSearch);
  private readonly section = inject(SettingsSection, { optional: true });

  readonly matches = computed(() => matchesSearch(`${this.label()} ${this.keywords()}`, this.search.query()));
  protected readonly hidden = computed(() => this.search.active() && !this.matches() && !(this.section?.titleMatches() ?? false));

  constructor() {
    this.section?.register(this);
    inject(DestroyRef).onDestroy(() => this.section?.unregister(this));
  }
}

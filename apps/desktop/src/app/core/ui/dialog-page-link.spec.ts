import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { DialogPageLink } from './dialog-page-link';

@Component({ imports: [DialogPageLink], template: '<app-dialog-page-link path="/customers" label="Customers" highlight="c1" />' })
class Host {}
@Component({ template: '' })
class Blank {}

describe('DialogPageLink', () => {
  async function render(url: string): Promise<HTMLAnchorElement | null> {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }])] });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector('a');
  }

  it('opens the record page with its row highlighted, when the dialog is over another page', async () => {
    const link = await render('/orders?view-customer=c1');
    expect(link?.getAttribute('aria-label')).toBe('Open Customers');
    expect(link?.getAttribute('href')).toBe('/customers?highlight=c1');
  });

  it('is not shown over its own page', async () => {
    expect(await render('/customers?view-customer=c1')).toBeNull();
  });
});

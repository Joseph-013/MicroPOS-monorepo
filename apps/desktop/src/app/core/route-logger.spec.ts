import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouteLogger } from './route-logger';

@Component({ template: '' })
class Blank {}

describe('RouteLogger', () => {
  const setup = (): Router => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }])] });
    TestBed.inject(RouteLogger);
    return TestBed.inject(Router);
  };

  it('logs every route change, query parameter changes included', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const router = setup();
    await router.navigateByUrl('/orders');
    await router.navigateByUrl('/orders?view-sales-order=a1');
    expect(log.mock.calls.map((c) => c[0])).toEqual(['[route] /orders', '[route] /orders?view-sales-order=a1']);
    log.mockRestore();
  });
});

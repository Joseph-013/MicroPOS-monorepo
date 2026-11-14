import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { DesktopApi } from '@micropos/core';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';
import { fakeAuthApi, sessionUser } from './auth/testing';
import { BannerService } from './banner';
import { OrderQrScan } from './order-qr-scan';
import { SalesOrderViewer } from './sales-order-viewer';
import { ScannerService } from './scanner';

@Component({ template: '' })
class Blank {}
const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('OrderQrScan', () => {
  async function setup(permissions: Parameters<typeof sessionUser>[0], known: Record<string, string> = { 'SO-1001': 'o1' }) {
    const asked: string[] = [];
    const api = {
      ...fakeAuthApi({ status: sessionUser(permissions) }).api,
      scanner: { onScan: () => () => undefined, setEnabled: () => Promise.resolve() },
      orders: { idByNumber: (n: string) => (asked.push(n), Promise.resolve(known[n] ?? null)) },
    } as unknown as DesktopApi;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), { provide: DESKTOP_API, useValue: api }] });
    await TestBed.inject(AuthService).whenReady();
    const opened: string[] = [];
    vi.spyOn(TestBed.inject(SalesOrderViewer), 'open').mockImplementation(async (id) => (opened.push(id), true));
    TestBed.inject(OrderQrScan);
    await TestBed.inject(Router).navigateByUrl('/');
    return { scanner: TestBed.inject(ScannerService), asked, opened, banner: TestBed.inject(BannerService) };
  }

  it('opens the sale named by a scanned receipt code, whatever else has the scanner', async () => {
    const { scanner, asked, opened } = await setup(['orders.view']);
    const claimed: string[] = [];
    scanner.claim(({ code }) => void claimed.push(code)); // a page that wants product codes
    scanner.receive('MICROPOS-ORDER-SO-1001');
    await wait();
    expect(asked).toEqual(['SO-1001']);
    expect(opened).toEqual(['o1']);
    expect(claimed).toEqual([]); // the page never saw it
  });

  it('leaves every other code to the pages', async () => {
    const { scanner, asked, opened } = await setup(['orders.view']);
    const claimed: string[] = [];
    scanner.claim(({ code }) => void claimed.push(code));
    scanner.receive('5900000000107');
    scanner.receive('SO-1001');
    await wait();
    expect(claimed).toEqual(['5900000000107', 'SO-1001']);
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
  });

  it('says when the order does not exist', async () => {
    const { scanner, opened, banner } = await setup(['orders.view'], {});
    scanner.receive('MICROPOS-ORDER-SO-9999');
    await wait();
    expect(opened).toEqual([]);
    expect(banner.current()?.text).toBe('Order SO-9999 not found');
  });

  it('does nothing but say so for someone who may not view sales orders', async () => {
    const { scanner, asked, opened, banner } = await setup(['checkout.sell']);
    const claimed: string[] = [];
    scanner.claim(({ code }) => void claimed.push(code));
    scanner.receive('MICROPOS-ORDER-SO-1001');
    await wait();
    expect(asked).toEqual([]);
    expect(opened).toEqual([]);
    expect(claimed).toEqual([]); // still not treated as an unknown product barcode
    expect(banner.current()?.text).toBe('You cannot open sales orders');
  });
});

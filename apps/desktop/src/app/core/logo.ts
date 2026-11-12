import { Component } from '@angular/core';

/** MicroPOS wordmark. "Micro" follows the text color, "POS" follows the accent (--primary). */
@Component({
  selector: 'app-logo',
  templateUrl: './logo.html',
  host: { class: 'inline-flex' },
})
export class Logo {}

import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavRail } from './core/nav-rail';

@Component({
  imports: [NavRail, RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {}

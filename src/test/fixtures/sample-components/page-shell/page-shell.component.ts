import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-page-shell',
  standalone: true,
  template: `
    <div class="page-shell">
      <header class="page-shell__header">
        <h1 class="page-shell__title">{{ title }}</h1>
        <button (click)="action.emit()">Action</button>
      </header>
      <main class="page-shell__content">
        <ng-content></ng-content>
      </main>
    </div>
  `,
  styles: [`
    .page-shell { min-height: 100vh; display: flex; flex-direction: column; }
    .page-shell__header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: #fff; border-bottom: 1px solid #e0e0e0; }
    .page-shell__title { font-size: 24px; font-weight: 700; margin: 0; }
    .page-shell__content { flex: 1; padding: 24px; }
  `],
})
export class PageShellComponent {
  /** Page title displayed in the header */
  @Input() title: string = '';

  /** Emits when the primary action button is clicked */
  @Output() action = new EventEmitter<void>();
}

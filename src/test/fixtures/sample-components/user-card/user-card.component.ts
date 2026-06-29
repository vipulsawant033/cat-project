import { Component, Input } from '@angular/core';

// @figma-component: 1234:5678

@Component({
  selector: 'app-user-card',
  standalone: true,
  template: `
    <div class="user-card" [class.elevated]="elevated">
      <h3 class="user-card__name">{{ name }}</h3>
      <p class="user-card__subtitle">{{ subtitle }}</p>
    </div>
  `,
  styles: [`
    .user-card { padding: 16px; border-radius: 8px; }
    .user-card.elevated { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
    .user-card__name { font-size: 18px; font-weight: 700; margin: 0; }
    .user-card__subtitle { font-size: 14px; color: #666; margin: 4px 0 0; }
  `],
})
export class UserCardComponent {
  /** The user's display name */
  @Input() name: string = '';

  /** Supporting text below the name */
  @Input() subtitle: string = '';

  /** Adds a drop shadow elevation */
  @Input() elevated: boolean = false;
}

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A status badge component for displaying contextual labels.
 */
@customElement('my-badge')
export class MyBadge extends LitElement {
  static styles = css`
    :host {
      --my-badge-bg: #e0e0e0;
      --my-badge-color: #333;
      --my-badge-radius: 12px;
      display: inline-flex;
    }
    span {
      background: var(--my-badge-bg);
      color: var(--my-badge-color);
      border-radius: var(--my-badge-radius);
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 600;
    }
    :host([color="info"]) span { --my-badge-bg: #e3f2fd; --my-badge-color: #1565c0; }
    :host([color="success"]) span { --my-badge-bg: #e8f5e9; --my-badge-color: #2e7d32; }
    :host([color="warning"]) span { --my-badge-bg: #fff8e1; --my-badge-color: #f57f17; }
    :host([color="error"]) span { --my-badge-bg: #ffebee; --my-badge-color: #c62828; }
  `;

  @property({ reflect: true })
  color: 'info' | 'success' | 'warning' | 'error' = 'info';

  render() {
    return html`<span><slot></slot></span>`;
  }
}

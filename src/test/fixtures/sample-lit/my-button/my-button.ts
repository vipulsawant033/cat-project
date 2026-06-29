import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A primary action button component.
 * @fires click-action - Fired when the button is clicked
 * @figma-component 9999:1111
 */
@customElement('my-button')
export class MyButton extends LitElement {
  static styles = css`
    :host {
      --my-button-bg: #1a73e8;
      --my-button-color: #ffffff;
      --my-button-radius: 4px;
      --my-button-padding: 8px 16px;
      display: inline-block;
    }
    button {
      background: var(--my-button-bg);
      color: var(--my-button-color);
      border-radius: var(--my-button-radius);
      padding: var(--my-button-padding);
      border: none;
      cursor: pointer;
      font-weight: 600;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    :host([variant="secondary"]) button { background: transparent; color: var(--my-button-bg); border: 2px solid var(--my-button-bg); }
    :host([variant="ghost"]) button { background: transparent; color: var(--my-button-bg); border: none; }
    :host([size="sm"]) button { padding: 4px 8px; font-size: 12px; }
    :host([size="lg"]) button { padding: 12px 24px; font-size: 18px; }
  `;

  @property({ reflect: true })
  variant: 'primary' | 'secondary' | 'ghost' = 'primary';

  @property({ reflect: true })
  size: 'sm' | 'md' | 'lg' = 'md';

  @property({ type: Boolean, reflect: true })
  disabled = false;

  render() {
    return html`
      <button
        ?disabled="${this.disabled}"
        @click="${this._handleClick}">
        <slot></slot>
      </button>
    `;
  }

  private _handleClick() {
    this.dispatchEvent(new CustomEvent('click-action', { bubbles: true, composed: true }));
  }
}

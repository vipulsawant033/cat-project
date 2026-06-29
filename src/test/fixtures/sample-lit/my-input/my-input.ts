import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * A text input field with label support.
 * @fires input-change - Fired when input value changes
 */
@customElement('my-input')
export class MyInput extends LitElement {
  static styles = css`
    :host {
      --my-input-border: #ccc;
      --my-input-focus-border: #1a73e8;
      --my-input-bg: #fff;
      --my-input-radius: 4px;
      display: block;
    }
    .wrapper { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 14px; font-weight: 500; }
    .input-wrapper { display: flex; align-items: center; border: 1px solid var(--my-input-border); border-radius: var(--my-input-radius); background: var(--my-input-bg); padding: 0 8px; }
    .input-wrapper:focus-within { border-color: var(--my-input-focus-border); }
    input { flex: 1; border: none; outline: none; padding: 8px 0; background: transparent; font-size: 14px; }
    ::slotted(*) { margin-right: 8px; }
  `;

  @property()
  label: string = '';

  @property()
  placeholder: string = '';

  @property({ reflect: true })
  type: 'text' | 'email' | 'password' = 'text';

  render() {
    return html`
      <div class="wrapper">
        ${this.label ? html`<label>${this.label}</label>` : ''}
        <div class="input-wrapper">
          <slot></slot>
          <input
            type="${this.type}"
            placeholder="${this.placeholder}"
            @input="${this._handleInput}" />
        </div>
      </div>
    `;
  }

  private _handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    this.dispatchEvent(new CustomEvent('input-change', { detail: { value }, bubbles: true, composed: true }));
  }
}

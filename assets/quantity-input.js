(() => {
  if (customElements.get("quantity-input")) return;

  class QuantityInput extends HTMLElement {
    constructor() {
      super();

      this.input = this.querySelector("[data-quantity-field]");
      this.minusButton = this.querySelector("[data-quantity-minus]");
      this.plusButton = this.querySelector("[data-quantity-plus]");

      this.onButtonClick = this.onButtonClick.bind(this);
      this.onInputChange = this.onInputChange.bind(this);
    }

    connectedCallback() {
      if (!this.input) return;

      this.minusButton?.addEventListener("click", this.onButtonClick);
      this.plusButton?.addEventListener("click", this.onButtonClick);
      this.input.addEventListener("change", this.onInputChange);

      this.disabledObserver = new MutationObserver(() => this.updateButtonStates());
      this.disabledObserver.observe(this.input, {
        attributes: true,
        attributeFilter: ["disabled", "min", "max"],
      });

      this.updateButtonStates();
    }

    disconnectedCallback() {
      this.minusButton?.removeEventListener("click", this.onButtonClick);
      this.plusButton?.removeEventListener("click", this.onButtonClick);
      this.input?.removeEventListener("change", this.onInputChange);
      this.disabledObserver?.disconnect();
    }

    onButtonClick(event) {
      event.preventDefault();

      if (!this.input || this.input.disabled) return;

      const previousValue = this.input.value;
      const step = this.getStep();
      const currentValue = this.getCurrentValue();

      let nextValue = currentValue;

      if (event.currentTarget.name === "plus") {
        nextValue = currentValue + step;
      }

      if (event.currentTarget.name === "minus") {
        nextValue = currentValue - step;
      }

      this.input.value = this.normalizeValue(nextValue);
      this.updateButtonStates();

      if (this.input.value !== previousValue) {
        this.input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    onInputChange() {
      this.input.value = this.normalizeValue(this.getCurrentValue());
      this.updateButtonStates();
    }

    getCurrentValue() {
      const value = Number(this.input.value);
      return Number.isFinite(value) ? value : this.getMin();
    }

    getMin() {
      const raw = this.input.getAttribute("min");
      if (raw === null || raw === "") return 1;
      const m = Number(raw);
      return Number.isFinite(m) ? m : 1;
    }

    getRuleMin() {
      // Quantity rule minimum from Shopify (independent of native input min,
      // which may be 0 in cart contexts to allow removal). Falls back to
      // native min when no rule is provided.
      const raw = this.input.dataset.min;
      if (raw === undefined || raw === "") return this.getMin();
      const m = Number(raw);
      return Number.isFinite(m) ? m : this.getMin();
    }

    getMax() {
      // Number(null) is 0 and Number.isFinite(0) is true, so we must
      // explicitly check for missing/empty attribute before converting —
      // otherwise products without a quantity_rule.max (i.e. no max attr
      // rendered by Liquid) would clamp every value to 0.
      const raw = this.input.getAttribute("max");
      if (raw === null || raw === "") return null;
      const m = Number(raw);
      return Number.isFinite(m) ? m : null;
    }

    getStep() {
      const raw = this.input.dataset.step || this.input.getAttribute("step");
      if (raw === undefined || raw === null || raw === "") return 1;
      const s = Number(raw);
      return Number.isFinite(s) && s > 0 ? s : 1;
    }

    normalizeValue(value) {
      const nativeMin = this.getMin();
      const ruleMin = this.getRuleMin();
      const max = this.getMax();
      const step = this.getStep();

      let nextValue = Number.isFinite(value) ? value : nativeMin;

      // Allow 0 only when the native min permits it (cart contexts use
      // min=0 for removal). Outside cart contexts, native min is >= ruleMin
      // so this branch never fires.
      if (nativeMin === 0 && nextValue === 0) {
        return "0";
      }

      // Otherwise enforce the quantity rule minimum
      if (nextValue < ruleMin) {
        nextValue = ruleMin;
      }

      if (max !== null && nextValue > max) {
        nextValue = max;
      }

      // Snap to step grid relative to ruleMin
      if (step > 1 && nextValue > ruleMin) {
        const offset = nextValue - ruleMin;
        nextValue = ruleMin + Math.round(offset / step) * step;
      }

      if (max !== null && nextValue > max) {
        nextValue = max;
      }

      return String(nextValue);
    }

    updateButtonStates() {
      if (!this.input) return;

      const value = this.getCurrentValue();
      const nativeMin = this.getMin();
      const max = this.getMax();

      // Minus is disabled when value is at the native minimum (0 in cart,
      // 1 elsewhere). The rule minimum is enforced on the way down via
      // normalizeValue, not by disabling the button.
      if (this.minusButton) {
        this.minusButton.disabled = this.input.disabled || value <= nativeMin;
      }

      if (this.plusButton) {
        this.plusButton.disabled = this.input.disabled || (max !== null && value >= max);
      }
    }
  }

  customElements.define("quantity-input", QuantityInput);
})();

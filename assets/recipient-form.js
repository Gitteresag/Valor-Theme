(function () {
  if (typeof customElements === "undefined" || customElements.get("valor-recipient-form")) return;

  class ValorRecipientForm extends HTMLElement {
    constructor() {
      super();
      this._handleChange = this.onChange.bind(this);
      this._handleSuccess = this.onProductFormSuccess.bind(this);
      this._handleError = this.onProductFormError.bind(this);
    }

    connectedCallback() {
      if (this._initialized) return;
      this._initialized = true;

      this.form = this.closest("form");
      this.toggle = this.querySelector("[data-recipient-toggle]");
      this.fields = this.querySelector("[data-recipient-fields]");
      this.liveRegion = this.querySelector("[data-recipient-live-region]");
      this.offsetInput = this.querySelector("[data-recipient-offset]");
      this.emailInput = this.querySelector("[data-recipient-email]");
      this.errorBox = this.querySelector("[data-recipient-errors]");
      this.errorList = this.querySelector("[data-recipient-error-list]");
      this.fieldInputs = Array.prototype.slice.call(this.querySelectorAll("[data-recipient-field]"));

      if (this.offsetInput) this.offsetInput.value = String(new Date().getTimezoneOffset());
      if (this.toggle) this.toggle.addEventListener("change", this._handleChange);
      document.addEventListener("valor:product-form:success", this._handleSuccess);
      document.addEventListener("valor:product-form:error", this._handleError);
      this.onChange();
    }

    disconnectedCallback() {
      if (this.toggle) this.toggle.removeEventListener("change", this._handleChange);
      document.removeEventListener("valor:product-form:success", this._handleSuccess);
      document.removeEventListener("valor:product-form:error", this._handleError);
      this._initialized = false;
    }

    onChange() {
      const expanded = !!(this.toggle && this.toggle.checked);
      if (this.toggle) this.toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      if (this.fields) this.fields.hidden = !expanded;
      this.fieldInputs.forEach((field) => {
        field.disabled = !expanded;
        if (!expanded) field.value = "";
      });
      if (this.emailInput) this.emailInput.required = expanded;
      if (this.offsetInput) this.offsetInput.disabled = !expanded;
      if (!expanded) this.clearErrors();
      if (this.liveRegion) {
        this.liveRegion.textContent = expanded ? this.dataset.expandedText || "" : this.dataset.collapsedText || "";
      }
    }

    onProductFormSuccess(event) {
      if (!event.detail || event.detail.form !== this.form) return;
      this.reset();
    }

    onProductFormError(event) {
      if (!event.detail || event.detail.form !== this.form) return;
      this.displayErrors(event.detail.body);
    }

    reset() {
      if (this.toggle) this.toggle.checked = false;
      this.onChange();
    }

    displayErrors(body) {
      if (!body) return;
      const errors = body.errors || null;
      this.clearErrors();

      if (this.errorBox) this.errorBox.hidden = false;

      if (errors && typeof errors === "object") {
        Object.keys(errors).forEach((key) => {
          const message = Array.isArray(errors[key]) ? errors[key].join(", ") : String(errors[key]);
          this.addError(key, message);
        });
      } else if (this.errorList) {
        const li = document.createElement("li");
        li.textContent = body.description || body.message || "";
        this.errorList.appendChild(li);
      }
    }

    addError(key, message) {
      const normalized = this.normalizeErrorKey(key);
      const fieldError = this.querySelector('[data-recipient-field-error="' + normalized + '"]');
      const field = this.querySelector('[data-recipient-field-row="' + normalized + '"] [data-recipient-field]');

      if (fieldError) {
        fieldError.textContent = message;
        fieldError.hidden = false;
      }
      if (field) {
        field.setAttribute("aria-invalid", "true");
        if (fieldError && fieldError.id) field.setAttribute("aria-describedby", fieldError.id);
      }
      if (this.errorList) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        if (field && field.id) link.href = "#" + field.id;
        link.textContent = message;
        li.appendChild(link);
        this.errorList.appendChild(li);
      }
    }

    normalizeErrorKey(key) {
      const value = String(key).toLowerCase().replace(/\s+/g, "_");
      if (value.indexOf("email") !== -1) return "email";
      if (value.indexOf("name") !== -1) return "name";
      if (value.indexOf("message") !== -1) return "message";
      if (value.indexOf("send") !== -1) return "send_on";
      return value;
    }

    clearErrors() {
      if (this.errorBox) this.errorBox.hidden = true;
      if (this.errorList) this.errorList.innerHTML = "";
      this.querySelectorAll("[data-recipient-field-error]").forEach((el) => {
        el.textContent = "";
        el.hidden = true;
      });
      this.fieldInputs.forEach((field) => {
        field.removeAttribute("aria-invalid");
        field.removeAttribute("aria-describedby");
      });
    }
  }

  customElements.define("valor-recipient-form", ValorRecipientForm);
})();

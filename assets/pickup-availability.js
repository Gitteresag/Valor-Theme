(function () {
  if (typeof customElements === 'undefined') return;

  if (!customElements.get('valor-pickup-availability')) {
    customElements.define(
      'valor-pickup-availability',
      class ValorPickupAvailability extends HTMLElement {
        constructor() {
          super();
          this._handleRefresh = this.refresh.bind(this);
        }

        connectedCallback() {
          if (this._initialized) return;
          this._initialized = true;
          this.errorHtml = this.querySelector('template') && this.querySelector('template').content.firstElementChild
            ? this.querySelector('template').content.firstElementChild.cloneNode(true)
            : null;
          if (this.hasAttribute('available')) this.fetchAvailability(this.dataset.variantId);
        }

        update(variant) {
          if (variant && variant.available && variant.id) {
            this.dataset.variantId = variant.id;
            this.fetchAvailability(variant.id);
          } else {
            this.clear();
          }
        }

        refresh() {
          if (this.dataset.variantId) this.fetchAvailability(this.dataset.variantId);
        }

        fetchAvailability(variantId) {
          if (!variantId) {
            this.clear();
            return;
          }

          if (this.abortController) this.abortController.abort();
          this.abortController = new AbortController();
          this.setAttribute('aria-busy', 'true');

          let rootUrl = this.dataset.rootUrl || '/';
          if (rootUrl.charAt(rootUrl.length - 1) !== '/') rootUrl += '/';

          fetch(rootUrl + 'variants/' + variantId + '/?section_id=pickup-availability', {
            signal: this.abortController.signal,
            credentials: 'same-origin'
          })
            .then((response) => response.text())
            .then((text) => {
              const section = new DOMParser().parseFromString(text, 'text/html').querySelector('.shopify-section');
              this.render(section);
            })
            .catch((error) => {
              if (error && error.name === 'AbortError') return;
              this.renderError();
            })
            .finally(() => {
              this.removeAttribute('aria-busy');
            });
        }

        render(section) {
          if (!section) {
            this.clear();
            return;
          }

          const preview = section.querySelector('valor-pickup-availability-preview');
          const drawer = section.querySelector('valor-pickup-availability-drawer');
          this.removeDrawer();

          if (!preview || !drawer) {
            this.clear();
            return;
          }

          this.innerHTML = preview.outerHTML;
          const owner = this.dataset.pickupId || this.id || '';
          drawer.dataset.pickupOwner = owner;
          const title = drawer.querySelector('.valor-pickup-drawer__title');
          if (title && owner) {
            const titleId = 'ValorPickupAvailabilityTitle-' + owner;
            title.id = titleId;
            drawer.setAttribute('aria-labelledby', titleId);
          }
          document.body.appendChild(drawer);

          const button = this.querySelector('[data-pickup-open]');
          if (button) {
            button.addEventListener('click', () => {
              const activeDrawer = document.querySelector('valor-pickup-availability-drawer[data-pickup-owner="' + owner + '"]');
              if (activeDrawer && typeof activeDrawer.show === 'function') activeDrawer.show(button);
            });
          }
        }

        renderError() {
          this.removeDrawer();
          if (!this.errorHtml) {
            this.clear();
            return;
          }
          this.innerHTML = '';
          const error = this.errorHtml.cloneNode(true);
          this.appendChild(error);
          const refreshButton = this.querySelector('[data-pickup-refresh]');
          if (refreshButton) refreshButton.addEventListener('click', this._handleRefresh);
        }

        clear() {
          this.removeDrawer();
          this.innerHTML = '';
          this.removeAttribute('available');
        }

        removeDrawer() {
          const owner = this.dataset.pickupId || this.id || '';
          if (!owner) return;
          document.querySelectorAll('valor-pickup-availability-drawer[data-pickup-owner="' + owner + '"]').forEach((drawer) => {
            drawer.remove();
          });
        }
      }
    );
  }

  if (!customElements.get('valor-pickup-availability-drawer')) {
    customElements.define(
      'valor-pickup-availability-drawer',
      class ValorPickupAvailabilityDrawer extends HTMLElement {
        constructor() {
          super();
          this._handleKeydown = this.onKeydown.bind(this);
          this._handleClose = this.hide.bind(this);
        }

        connectedCallback() {
          if (this._initialized) return;
          this._initialized = true;
          this.querySelectorAll('[data-pickup-close]').forEach((button) => {
            button.addEventListener('click', this._handleClose);
          });
          this.addEventListener('keydown', this._handleKeydown);
        }

        disconnectedCallback() {
          this.querySelectorAll('[data-pickup-close]').forEach((button) => {
            button.removeEventListener('click', this._handleClose);
          });
          this.removeEventListener('keydown', this._handleKeydown);
          if (this.hasAttribute('open')) document.body.classList.remove('valor-pickup-drawer-open');
        }

        show(trigger) {
          this.trigger = trigger;
          this.hidden = false;
          this.setAttribute('open', '');
          document.body.classList.add('valor-pickup-drawer-open');
          const focusTarget = this.querySelector('[data-pickup-close]');
          if (focusTarget) focusTarget.focus();
        }

        hide() {
          this.removeAttribute('open');
          this.hidden = true;
          document.body.classList.remove('valor-pickup-drawer-open');
          if (this.trigger && typeof this.trigger.focus === 'function') this.trigger.focus();
        }

        onKeydown(event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            this.hide();
            return;
          }
          if (event.key !== 'Tab') return;

          const focusable = Array.prototype.slice.call(
            this.querySelectorAll('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
          ).filter((el) => el.offsetParent !== null);
          if (!focusable.length) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    );
  }
})();

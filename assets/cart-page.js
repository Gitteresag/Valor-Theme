/* Valor Cart Page
 *
 * Native Shopify Cart API:
 *   POST /cart/change.js  — change quantity by line (or remove with quantity=0)
 *   POST /cart/update.js  — apply/remove discount code, update cart note
 *   GET  /?section_id=main-cart  — re-render the cart page section (fallback)
 *
 * All cart mutations use Shopify's bundled section rendering. The request
 * includes a sections=<section-id> parameter so the response carries the
 * freshly rendered cart-page HTML in a single round trip. Renders are
 * atomic; the items list, summary totals, and applied discounts never
 * disagree with the server's view of the cart.
 *
 * Cart-state broadcast: every mutation ends with one canonical
 * dispatch of the valor:cart:updated event whose detail is the full
 * cart object. This is the same event the cart drawer dispatches, so
 * any listener (header bubble fallback, in-cart product label, etc.)
 * stays in sync regardless of which surface initiated the change.
 *
 * Discount apply/remove uses cart/update.js with a JSON body, not a
 * query string. Shopify's discount parameter replaces the full code
 * list every time, so apply sends existing codes plus the new one,
 * and remove sends all remaining codes except the one being removed.
 * The comma-separated list is built in handleDiscountSubmit() and
 * handleDiscountRemove() further down in this file.
 *
 * Cart note updates fire on the textarea's change event, which
 * triggers on blur after a value change. No debounce: the user has
 * already moved focus away, and one POST per actual edit is fine.
 *
 * Active discount codes are rendered exclusively by Liquid in
 * main-cart.liquid, both on initial page load and on AJAX-driven
 * bundled section renders. The Liquid loop unions three sources:
 * cart.cart_level_discount_applications, cart.items[].line_level_
 * discount_allocations (both filtered to type == 'discount_code'),
 * and cart.discount_codes (which catches free-shipping codes that
 * don't show up in either of the first two). When a shipping code
 * is present, an "applied at checkout" notice renders below the
 * list, since shipping codes don't affect the cart subtotal —
 * their effect is computed at checkout once an address is known.
 * getApplicableDiscountCodes() in this file mirrors the same union
 * for AJAX cart objects (used by _cartHasCode() to detect invalid
 * codes after apply). Apply and remove operations send the full
 * comma-separated list of codes (existing ± the change) to
 * cart/update.js, because Shopify's discount parameter replaces
 * the entire set every time.
 *
 * All cart endpoints are constructed with Shopify.routes.root via
 * cartUrl() so the theme works correctly across multilingual /
 * multi-market setups.
 */

(function () {
  if (window.ValorCartPage && window.ValorCartPage._initialized) return;

  var CART_ICON_BUBBLE_SELECTOR = '.valor-header__cart';
  var CART_COUNT_SELECTOR = '.valor-cart-count';
  var CART_DRAWER_SECTION_ID = 'cart-drawer';

  function routeRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  }
  function cartUrl(path) {
    var root = routeRoot();
    if (root.charAt(root.length - 1) !== '/') root += '/';
    return root + path.replace(/^\//, '');
  }

  /* Update the header cart icon bubble manually. The cart-icon-bubble
     isn't its own Shopify section in Valor, so we mutate the DOM
     directly instead of pulling a section render. Mirrors the same
     logic the drawer uses, intentionally — both surfaces should
     update the bubble identically.

     Updates two elements:
       - .valor-cart-count: visible bubble (created/removed as count changes)
       - [data-cart-count-text]: screen-reader text, always present, count
         interpolated into a data-template string. */
  function updateCartIconBubble(cart) {
    var cartLink = document.querySelector(CART_ICON_BUBBLE_SELECTOR);
    if (!cartLink) return;
    var bubble = cartLink.querySelector(CART_COUNT_SELECTOR);
    var hiddenText = cartLink.querySelector('[data-cart-count-text]');
    var count = cart.item_count;

    if (count > 0) {
      if (!bubble) {
        bubble = document.createElement('span');
        bubble.className = 'valor-cart-count';
        bubble.setAttribute('aria-hidden', 'true');
        if (hiddenText) {
          cartLink.insertBefore(bubble, hiddenText);
        } else {
          cartLink.appendChild(bubble);
        }
      }
      bubble.textContent = count < 100 ? String(count) : '';
    } else if (bubble) {
      bubble.remove();
    }

    if (hiddenText) {
      var template = hiddenText.dataset.template;
      if (template) {
        hiddenText.textContent = template.replace('%count%', count);
      }
    }
  }

  function broadcastCartState(cart) {
    document.dispatchEvent(
      new CustomEvent('valor:cart:updated', { detail: cart })
    );
  }


  /* Collect customer-applied discount code titles for the active-codes
     list. Three sources mirror the Liquid logic at the top of
     main-cart.liquid (and cart-drawer.liquid):

       1. cart.cart_level_discount_applications  (subtotal codes)
       2. cart.items[].line_level_discount_allocations  (per-product codes)
       3. cart.discount_codes  (shipping codes that don't change subtotal)

     1+2 catch codes whose effect is visible immediately as money in the
     totals; 3 catches shipping-only codes whose effect is deferred to
     checkout. Adding all three (de-duped) means _cartHasCode() recognises
     a freshly-applied code regardless of which type it is, and the
     active-codes list always stays consistent with what Liquid renders.

     Automatic discounts and product compare-at sale prices are excluded
     — they don't have type 'discount_code' / aren't in cart.discount_codes. */
  function getApplicableDiscountCodes(cart) {
    if (!cart) return [];
    var seen = Object.create(null);
    var codes = [];

    function add(title) {
      if (!title) return;
      var t = String(title).trim();
      if (!t) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      codes.push(t);
    }

    if (Array.isArray(cart.cart_level_discount_applications)) {
      cart.cart_level_discount_applications.forEach(function (app) {
        if (app && app.type === 'discount_code') add(app.title);
      });
    }

    if (Array.isArray(cart.items)) {
      cart.items.forEach(function (item) {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) return;
        item.line_level_discount_allocations.forEach(function (alloc) {
          if (alloc && alloc.discount_application && alloc.discount_application.type === 'discount_code') {
            add(alloc.discount_application.title);
          }
        });
      });
    }

    if (Array.isArray(cart.discount_codes)) {
      cart.discount_codes.forEach(function (entry) {
        if (entry && entry.code) add(entry.code);
      });
    }

    return codes;
  }

  /* Codes that exist in cart.discount_codes but NOT in either
     cart_level_discount_applications or line_level_discount_allocations.
     These are typically shipping discounts whose effect is deferred
     to checkout (they don't change subtotal, so Shopify doesn't
     attach them to a cart-level or line-level application until an
     address is provided). They are real, applied codes — we just
     can't render them via Liquid because cart.discount_codes is not
     reliably populated server-side for manual codes. We render their
     pills with JS instead, both on page load (via GET /cart.js) and
     after each AJAX cart mutation. */
  function getShippingDiscountCodes(cart) {
    if (!cart || !Array.isArray(cart.discount_codes)) return [];

    var visibleSet = Object.create(null);
    if (Array.isArray(cart.cart_level_discount_applications)) {
      cart.cart_level_discount_applications.forEach(function (app) {
        if (app && app.type === 'discount_code' && app.title) {
          visibleSet[String(app.title).toLowerCase()] = true;
        }
      });
    }
    if (Array.isArray(cart.items)) {
      cart.items.forEach(function (item) {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) return;
        item.line_level_discount_allocations.forEach(function (alloc) {
          if (alloc && alloc.discount_application && alloc.discount_application.type === 'discount_code') {
            visibleSet[String(alloc.discount_application.title).toLowerCase()] = true;
          }
        });
      });
    }

    var shippingCodes = [];
    var seen = Object.create(null);
    cart.discount_codes.forEach(function (entry) {
      if (!entry || !entry.code) return;
      var code = String(entry.code).trim();
      if (!code) return;
      var key = code.toLowerCase();
      if (visibleSet[key] || seen[key]) return;
      seen[key] = true;
      shippingCodes.push(code);
    });
    return shippingCodes;
  }

  /* Insert / update / remove shipping discount pills (and the
     companion notice) so the rendered DOM matches the cart object.
     Pills are JS-only because Liquid can't render them — see
     getShippingDiscountCodes() comment for why. Click handlers are
     attached directly to each injected button (not delegated)
     because the cart drawer also uses direct binding for its other
     controls; using a host-level delegate only on cart page would
     create surface-specific behaviour we'd have to remember. */
  function syncShippingPills(host, cart) {
    if (!host || !cart) return;
    var list = host.querySelector('[data-active-discounts]');
    if (!list) return;

    var isDrawer = host.tagName.toLowerCase() === 'valor-cart-drawer';
    var base = isDrawer ? 'valor-cart-drawer' : 'valor-cart';
    var shippingCodes = getShippingDiscountCodes(cart);
    var shippingSet = Object.create(null);
    shippingCodes.forEach(function (c) { shippingSet[c.toLowerCase()] = c; });

    // Drop any JS-injected shipping pills that no longer match the cart
    list.querySelectorAll('[data-shipping-pill]').forEach(function (pill) {
      var code = pill.getAttribute('data-discount-code') || '';
      if (!shippingSet[code.toLowerCase()]) pill.parentNode && pill.parentNode.removeChild(pill);
    });

    // Inject any missing shipping pills
    shippingCodes.forEach(function (code) {
      var existing = list.querySelector('[data-discount-code="' + cssEscape(code) + '"]');
      if (existing) return;
      list.appendChild(buildShippingPill(host, list, code, base));
    });

    // Visibility: hide list if empty, show if any pills present
    if (list.querySelector('[data-discount-code]')) {
      list.removeAttribute('hidden');
    } else {
      list.setAttribute('hidden', '');
    }

    // Notice: present iff at least one shipping pill is present
    var notice = list.parentNode ? list.parentNode.querySelector('[data-shipping-discount-notice]') : null;
    if (shippingCodes.length > 0) {
      if (!notice) {
        notice = document.createElement('p');
        notice.className = base + '__shipping-discount-notice';
        notice.setAttribute('data-shipping-discount-notice', '');
        notice.textContent = host.dataset.stringsShippingNotice || 'Shipping discount will be applied at checkout.';
        if (list.nextSibling) {
          list.parentNode.insertBefore(notice, list.nextSibling);
        } else {
          list.parentNode.appendChild(notice);
        }
      }
    } else if (notice) {
      notice.parentNode.removeChild(notice);
    }
  }

  function buildShippingPill(host, list, code, base) {
    var li = document.createElement('li');
    li.className = base + '__active-discount';
    li.setAttribute('data-discount-code', code);
    li.setAttribute('data-shipping-pill', '');

    var label = document.createElement('span');
    label.className = base + '__discount-label';

    var icon = document.createElement('span');
    icon.className = base + '__discount-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u2212';

    var title = document.createElement('span');
    title.className = base + '__discount-title';
    title.textContent = code;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = base + '__discount-remove';
    btn.setAttribute('data-discount-remove', '');
    btn.setAttribute('data-discount-code', code);
    var removeLabel = host.dataset.stringsRemoveDiscount || (list.dataset.removeLabel || 'Remove discount');
    btn.setAttribute('aria-label', removeLabel + ': ' + code);
    btn.innerHTML = '<span aria-hidden="true">\u00d7</span>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof host.removeDiscount === 'function') host.removeDiscount(code);
    });

    label.appendChild(icon);
    label.appendChild(title);
    li.appendChild(label);
    li.appendChild(btn);
    return li;
  }

  /* Minimal CSS.escape polyfill for attribute selectors. Discount codes
     can contain unusual characters (rare but allowed). */
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return '\\' + c.charCodeAt(0).toString(16) + ' ';
    });
  }

  /* ----- <valor-cart-page> custom element ----- */
  if (!customElements.get('valor-cart-page')) {
    customElements.define(
      'valor-cart-page',
      class ValorCartPage extends HTMLElement {
        connectedCallback() {
          this.sectionId = this.dataset.sectionId;
          this.liveRegion = this.querySelector('[data-cart-live-region]');

          if (!this._bound) {
            this._bindDelegatedEvents();
            this._bound = true;
          }

          if (!this._broadcastBound) {
            this._onExternalCartUpdate = this._onExternalCartUpdate.bind(this);
            document.addEventListener('valor:cart:updated', this._onExternalCartUpdate);
            this._broadcastBound = true;
          }

          // Page-load shipping pill sync: GET /cart.js to find any
          // shipping codes that Liquid couldn't render server-side.
          // One-shot per element instance; subsequent cart mutations
          // already include the cart object in their AJAX response.
          if (!this._shippingSynced) {
            this._shippingSynced = true;
            var self = this;
            fetch(cartUrl('cart.js'), { credentials: 'same-origin' })
              .then(function (r) { return r.json(); })
              .then(function (cart) { syncShippingPills(self, cart); })
              .catch(function () {});
          }
        }

        disconnectedCallback() {
          if (this._broadcastBound) {
            document.removeEventListener('valor:cart:updated', this._onExternalCartUpdate);
            this._broadcastBound = false;
          }
        }

        /* External cart mutations (e.g. drawer remove) trigger a section
           refresh so our markup re-syncs. We skip the event we dispatched
           ourselves to avoid an infinite loop. */
        _onExternalCartUpdate() {
          if (this._suppressNextBroadcast) {
            this._suppressNextBroadcast = false;
            return;
          }
          this.refreshSection();
        }

        _bindDelegatedEvents() {
          var self = this;

          /* All change events: quantity inputs (from <quantity-input>) and
             cart note textareas (which fire change on blur after value
             changes). One handler routes by data attribute. */
          this.addEventListener('change', function (event) {
            var target = event.target;
            if (!target.matches) return;

            if (target.matches('[data-quantity-field]')) {
              var line = parseInt(target.dataset.line, 10);
              var quantity = parseInt(target.value, 10);
              if (isNaN(line) || isNaN(quantity)) return;
              self.changeLine(line, quantity, target);
              return;
            }

            if (target.matches('[data-cart-note]')) {
              self.updateNote(target.value);
              return;
            }
          });

          /* Click delegation: line remove buttons, discount remove buttons,
             and discount apply buttons. The discount UI intentionally uses
             a non-form wrapper because the cart checkout form already wraps
             the page layout; nested forms are invalid HTML. */
          this.addEventListener('click', function (event) {
            var discountApply = event.target.closest('[data-discount-apply]');
            if (discountApply) {
              event.preventDefault();
              var discountForm = discountApply.closest('[data-discount-form]');
              self.submitDiscount(discountForm);
              return;
            }

            var discountRemove = event.target.closest('[data-discount-remove]');
            if (discountRemove) {
              event.preventDefault();
              var code = discountRemove.getAttribute('data-discount-code');
              if (code) self.removeDiscount(code);
              return;
            }

            var lineRemove = event.target.closest('[data-line-remove]');
            if (lineRemove) {
              event.preventDefault();
              var line = parseInt(lineRemove.dataset.line, 10);
              if (!isNaN(line)) self.changeLine(line, 0, null);
              return;
            }
          });

          /* Pressing Enter in the discount input applies the code without
             relying on a nested form submit. */
          this.addEventListener('keydown', function (event) {
            var input = event.target.closest('[data-discount-input]');
            if (!input || event.key !== 'Enter') return;
            event.preventDefault();
            self.submitDiscount(input.closest('[data-discount-form]'));
          });
        }

        /* ----- Cart mutations ----- */

        /* Per-line quantity change. quantity=0 removes the line.
           Bundled section render: one POST returns cart object + freshly
           rendered cart-page HTML. */
        changeLine(line, quantity, sourceInput) {
          var self = this;
          if (!this.sectionId) return;

          this.setBusy(true);
          this.setLineBusy(line, true);
          this.clearLineError(line);

          var body = {
            line: line,
            quantity: quantity,
            sections: this.getSectionsToRender(),
            sections_url: window.location.pathname
          };

          fetch(cartUrl('cart/change.js'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify(body)
          })
            .then(function (response) {
              return response.json().then(function (data) {
                return { ok: response.ok, status: response.status, data: data };
              });
            })
            .then(function (result) {
              if (!result.ok) {
                self.handleLineError(line, result.data, sourceInput);
                self.setLineBusy(line, false);
                self.setBusy(false);
                return;
              }

              var cart = result.data;
              if (self.applyCartResponse(cart)) {
                self.announce(self.formatUpdateMessage(cart, line, quantity));
                return;
              }
              return self.refreshSection();
            })
            .catch(function (err) {
              console.error('[Valor cart] change failed:', err);
              self.handleLineError(line, null, sourceInput);
              self.setLineBusy(line, false);
              self.setBusy(false);
            });
        }

        submitDiscount(form) {
          if (!form) return;
          var input = form.querySelector('[data-discount-input]');
          var code = input ? input.value.trim() : '';
          if (!code) return;
          this.applyDiscount(code, form);
        }

        /* Read currently-applied discount code titles from the rendered
           DOM. Each active-discount <li> carries the title in its
           data-discount-code attribute; this lets us send the canonical
           comma-separated list to cart/update.js without depending on
           cart.discount_codes (which is unreliable for line-level codes). */
        getExistingDiscountsFromDom() {
          var nodes = this.querySelectorAll('[data-active-discounts] [data-discount-code]');
          var codes = [];
          for (var i = 0; i < nodes.length; i++) {
            var c = nodes[i].getAttribute('data-discount-code');
            if (c) codes.push(c);
          }
          return codes;
        }

        /* Apply a discount code via cart/update.js with bundled section
           render. Shopify's discount parameter takes a comma-separated
           list of codes; sending one code by itself would silently
           remove any others, so we always include the existing codes
           plus the new one. If the new code is invalid, Shopify
           accepts the request but the code does not appear among the
           applicable discounts in the response — we detect that via
           _cartHasCode() and show an inline error. */
        applyDiscount(code, form) {
          var self = this;
          if (!this.sectionId) return;

          var messageEl = form ? form.querySelector('[data-discount-message]') : null;
          var applyBtn = form ? form.querySelector('[data-discount-apply]') : null;
          this.setDiscountMessage(messageEl, '', null);
          if (applyBtn) applyBtn.disabled = true;
          this.setBusy(true);

          var existing = this.getExistingDiscountsFromDom();
          // De-duplicate against the new code (case-insensitive) so we
          // don't end up with "SAVE15,SAVE15" if the user re-enters a
          // code that's already applied.
          var lc = String(code).toLowerCase();
          var combined = existing.filter(function (c) { return String(c).toLowerCase() !== lc; });
          combined.push(code);

          fetch(cartUrl('cart/update.js'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({
              discount: combined.join(','),
              sections: this.getSectionsToRender(),
              sections_url: window.location.pathname
            })
          })
            .then(function (r) { return r.json(); })
            .then(function (cart) {
              var applied = self._cartHasCode(cart, code);

              if (applied) {
                // applyCartResponse() replaces the section's innerHTML
                // via bundled section render, so the messageEl from
                // before the fetch is now detached. Re-query AFTER the
                // render to write the success message into the fresh
                // DOM. announce() also fires for screen readers.
                var rendered = self.applyCartResponse(cart);
                if (!rendered) self.refreshSection();

                // For shipping codes the pill + the "Shipping discount
                // will be applied at checkout" notice already make the
                // status clear and stay visible across reloads, so we
                // skip the JS-only success message to avoid three
                // near-identical confirmations in a row. Visible codes
                // (cart-level / line-level) don't get a notice, so they
                // still need the inline success message.
                var shippingCodes = getShippingDiscountCodes(cart);
                var lcCode = String(code).toLowerCase();
                var isShippingCode = shippingCodes.some(function (c) {
                  return String(c).toLowerCase() === lcCode;
                });

                if (!isShippingCode) {
                  var freshMsg = self.querySelector('[data-discount-message]');
                  if (freshMsg) {
                    var tpl = self._getString('discount_applied') || '{{ code }} applied';
                    freshMsg.textContent = tpl.replace('{{ code }}', code);
                    freshMsg.setAttribute('data-state', 'success');
                  }
                }

                self.announce(self._getString('discount_added'));
              } else {
                // Code didn't take. Cart hasn't actually changed in a way
                // we need to render, but we still need to clear our busy
                // state and show the inline error.
                var invalidMsg = self._getString('discount_invalid')
                  || 'This discount code is not valid.';
                self.setDiscountMessage(messageEl, invalidMsg, 'error');
                self.announce(invalidMsg);
                self.setBusy(false);
                if (applyBtn) applyBtn.disabled = false;
              }
            })
            .catch(function (err) {
              console.error('[Valor cart] discount apply failed:', err);
              var errMsg = self._getString('error_generic')
                || 'Something went wrong. Please try again.';
              self.setDiscountMessage(messageEl, errMsg, 'error');
              self.setBusy(false);
              if (applyBtn) applyBtn.disabled = false;
            });
        }

        /* Remove a single applied discount code. Shopify's discount
           parameter replaces all codes with the supplied list, so to
           remove one specific code we send all the OTHERS, comma-
           separated. (Sending an empty string would remove every
           code, which is wrong when the cart has multiple applied.) */
        removeDiscount(codeToRemove) {
          var self = this;
          if (!this.sectionId || !codeToRemove) return;

          var existing = this.getExistingDiscountsFromDom();
          var lc = String(codeToRemove).toLowerCase();
          var remaining = existing.filter(function (c) { return String(c).toLowerCase() !== lc; });

          this.setBusy(true);

          fetch(cartUrl('cart/update.js'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({
              discount: remaining.join(','),
              sections: this.getSectionsToRender(),
              sections_url: window.location.pathname
            })
          })
            .then(function (r) { return r.json(); })
            .then(function (cart) {
              if (self.applyCartResponse(cart)) {
                self.announce(self._getString('discount_removed'));
              } else {
                self.refreshSection();
              }
            })
            .catch(function (err) {
              console.error('[Valor cart] discount remove failed:', err);
              self.refreshSection();
            });
        }

        /* Update the cart note. Triggered on textarea change (which fires
           on blur if the value has changed). No bundled section render
           needed because no visible totals depend on the note value —
           keeps the request light. */
        updateNote(note) {
          var self = this;

          fetch(cartUrl('cart/update.js'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({
              note: note,
              sections: this.getSectionsToRender(),
              sections_url: window.location.pathname
            })
          })
            .then(function (r) { return r.json(); })
            .then(function (cart) {
              if (self.applyCartResponse(cart)) {
                self.announce(self._getString('note_updated'));
              } else {
                self._suppressNextBroadcast = true;
                broadcastCartState(cart);
                self.announce(self._getString('note_updated'));
              }
            })
            .catch(function (err) {
              console.error('[Valor cart] note update failed:', err);
            });
        }

        /* ----- Section render helpers ----- */

        getSectionsToRender() {
          var sections = [];
          if (this.sectionId) sections.push(this.sectionId);
          if (document.getElementById('ValorCartDrawer')) {
            sections.push(CART_DRAWER_SECTION_ID);
          }
          return sections;
        }

        renderExternalSections(sections) {
          if (!sections || !sections[CART_DRAWER_SECTION_ID]) return;
          var drawer = document.getElementById('ValorCartDrawer');
          if (drawer && typeof drawer.renderFromSections === 'function') {
            drawer.renderFromSections(sections);
          }
        }

        /* Apply a cart response: render the freshly rendered section if
           the bundled response carried it, update the icon bubble, broadcast
           cart state. Returns true on success. */
        applyCartResponse(cart) {
          if (!cart) return false;
          this.renderExternalSections(cart.sections);
          var newSectionHtml = cart.sections && cart.sections[this.sectionId];
          if (!newSectionHtml) {
            updateCartIconBubble(cart);
            this._suppressNextBroadcast = true;
            broadcastCartState(cart);
            return false;
          }

          this.renderSection(newSectionHtml);
          updateCartIconBubble(cart);
          // Re-inject any shipping pills the new Liquid render didn't include
          syncShippingPills(this, cart);
          this._suppressNextBroadcast = true;
          broadcastCartState(cart);
          this.setBusy(false);
          return true;
        }

        renderSection(html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var fresh = doc.querySelector('valor-cart-page');
          if (!fresh) {
            this.refreshSection();
            return;
          }
          this.innerHTML = fresh.innerHTML;
          this.liveRegion = this.querySelector('[data-cart-live-region]');

          // The empty-cart recommendations block is rendered as a SIBLING
          // of <valor-cart-page>, not a child, so it would otherwise be
          // ignored when we swap our own innerHTML. Sync it manually:
          //   - fresh recs + current recs  → replace
          //   - fresh recs + no current    → insert after this element
          //   - no fresh   + current recs  → remove (cart no longer empty)
          //   - neither                    → no-op
          // This keeps the page state consistent across cart mutations
          // (e.g. removing the last item should reveal recommendations
          // immediately; adding the first item back should hide them).
          var parent = this.parentNode;
          if (parent) {
            var freshRecs = doc.querySelector('.valor-cart__recommendations');
            var currentRecs = parent.querySelector(':scope > .valor-cart__recommendations');
            if (freshRecs && currentRecs) {
              currentRecs.replaceWith(freshRecs);
            } else if (freshRecs && !currentRecs) {
              if (this.nextSibling) {
                parent.insertBefore(freshRecs, this.nextSibling);
              } else {
                parent.appendChild(freshRecs);
              }
            } else if (!freshRecs && currentRecs) {
              currentRecs.remove();
            }
          }
        }

        refreshSection() {
          var self = this;
          if (!this.sectionId) return;

          this.setBusy(true);
          fetch(window.location.pathname + '?section_id=' + encodeURIComponent(this.sectionId))
            .then(function (r) { return r.text(); })
            .then(function (html) {
              self.renderSection(html);
              self.setBusy(false);
            })
            .catch(function (err) {
              console.error('[Valor cart] section refresh failed:', err);
              self.setBusy(false);
            });
        }

        /* ----- Loading state ----- */

        setBusy(isBusy) {
          var items = this.querySelector('valor-cart-items');
          if (items) items.setAttribute('aria-busy', isBusy ? 'true' : 'false');
        }

        setLineBusy(line, isBusy) {
          var item = this.querySelector('[data-cart-item][data-line="' + line + '"]');
          if (!item) return;
          var input = item.querySelector('[data-quantity-field]');
          if (isBusy) {
            item.setAttribute('data-line-busy', 'true');
            if (input) input.disabled = true;
          } else {
            item.removeAttribute('data-line-busy');
            if (input) input.disabled = false;
          }
        }

        /* ----- Error & message handling ----- */

        handleLineError(line, errorData, sourceInput) {
          var message = (errorData && (errorData.description || errorData.message))
            || this._getString('error_generic')
            || 'Something went wrong. Please try again.';

          this.showLineError(line, message);
          this.announce(message);

          // Re-fetch section so the quantity input value reflects the cart's
          // authoritative state (Shopify doesn't roll back our optimistic value).
          if (sourceInput) {
            this.refreshSection();
          }
        }

        showLineError(line, message) {
          var errorEl = this.querySelector('[data-line-error][data-line="' + line + '"]');
          if (!errorEl) return;
          var small = errorEl.querySelector('small');
          if (small) small.textContent = message;
          errorEl.setAttribute('data-has-error', 'true');
        }

        clearLineError(line) {
          var errorEl = this.querySelector('[data-line-error][data-line="' + line + '"]');
          if (!errorEl) return;
          var small = errorEl.querySelector('small');
          if (small) small.textContent = '';
          errorEl.removeAttribute('data-has-error');
        }

        setDiscountMessage(messageEl, text, state) {
          if (!messageEl) return;
          messageEl.textContent = text || '';
          if (state) {
            messageEl.setAttribute('data-state', state);
          } else {
            messageEl.removeAttribute('data-state');
          }
        }

        /* ----- Live region ----- */

        announce(message) {
          if (!this.liveRegion || !message) return;
          this.liveRegion.textContent = '';
          var self = this;
          setTimeout(function () {
            if (self.liveRegion) self.liveRegion.textContent = message;
          }, 50);
        }

        formatUpdateMessage(cart, line, quantity) {
          if (quantity === 0) {
            return this._getString('item_removed') || 'Item removed.';
          }
          var subtotalStr = this._formatMoney(cart.items_subtotal_price || cart.total_price);
          var tpl = this._getString('item_updated')
            || 'Cart updated. Subtotal: {{ subtotal }}.';
          return tpl.replace('{{ subtotal }}', subtotalStr).replace('{{subtotal}}', subtotalStr);
        }

        /* Read a string from the data-strings-* attribute on the host,
           falling back to undefined. Liquid populates these attributes
           from the locale file so messages stay translatable. */
        _getString(key) {
          var camel = key.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); });
          return this.dataset['strings' + camel.charAt(0).toUpperCase() + camel.slice(1)];
        }

        _formatMoney(cents) {
          if (typeof window.Shopify === 'object' && typeof window.Shopify.formatMoney === 'function') {
            return window.Shopify.formatMoney(cents);
          }
          var amount = (cents / 100).toFixed(2);
          var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || '';
          return currency ? currency + ' ' + amount : amount;
        }

        /* Check whether a cart object's discount_codes array contains the
           given code (case-insensitive, applicable === true). Used to
           detect whether an apply attempt actually took. */
        /* Check if the cart contains the given code as an applicable
           customer-applied discount. Mirrors getApplicableDiscountCodes()
           — both cart-level and line-level sources count, so codes
           that target specific products are recognized. */
        _cartHasCode(cart, code) {
          if (!cart || !code) return false;
          var needle = String(code).trim().toLowerCase();
          if (!needle) return false;
          var titles = getApplicableDiscountCodes(cart);
          for (var i = 0; i < titles.length; i++) {
            if (String(titles[i]).toLowerCase() === needle) return true;
          }
          return false;
        }
      }
    );
  }

  window.ValorCartPage = { _initialized: true };
})();

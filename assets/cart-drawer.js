/* Valor Cart Drawer
 *
 * Native Shopify Cart API:
 *   POST /cart/add.js        — add an item (used by product forms)
 *   POST /cart/change.js     — change quantity by line item
 *   GET  /cart.js            — current cart state
 *   GET  /?section_id=cart-drawer  — re-render the drawer markup (fallback)
 *
 * Both the add-to-cart path and the per-line quantity-change path
 * use Shopify's "bundled section rendering" — the request includes a
 * sections=cart-drawer parameter, so the response carries the updated
 * drawer HTML in a single round trip. Renders are atomic; there's no
 * window in which the drawer markup, header bubble, and cart contents
 * can disagree.
 *
 * Cart-state broadcast: every mutation ends with one canonical
 * dispatch of the valor:cart:updated event whose detail is the full
 * cart object. Listeners (product-info in-cart label, etc.) read the
 * detail and don't fetch /cart.js themselves. /cart/change.js returns
 * the cart object inline, so the change path doesn't fetch /cart.js
 * at all; /cart/add.js doesn't, so the add path fetches /cart.js
 * exactly once on everyone's behalf.
 *
 * Discount codes use /discount/{CODE} which sets the Shopify discount
 * cookie silently (fetch with no-redirect), then we re-fetch the cart
 * section to show the updated totals. If the code is invalid, the
 * cart cookie is not set and the user sees an inline error.
 *
 * All cart endpoints are constructed with Shopify.routes.root via
 * cartUrl() so the theme works correctly across multilingual /
 * multi-market setups.
 */

(function () {
  if (window.ValorCartDrawer && window.ValorCartDrawer._initialized) return;

  var SECTION_ID = "cart-drawer";
  var CART_ICON_BUBBLE_SELECTOR = ".valor-header__cart";
  var CART_COUNT_SELECTOR = ".valor-cart-count";

  /* Locale-aware URL root. Falls back to '/' if Shopify global isn't
     loaded yet, which is fine for single-locale stores. */
  function routeRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  }
  function cartUrl(path) {
    var root = routeRoot();
    if (root.charAt(root.length - 1) !== "/") root += "/";
    return root + path.replace(/^\//, "");
  }

  /* Collect customer-applied discount code titles for the active-codes
     list. Three sources mirror the Liquid logic at the top of
     cart-drawer.liquid (and main-cart.liquid):

       1. cart.cart_level_discount_applications  (subtotal codes)
       2. cart.items[].line_level_discount_allocations  (per-product codes)
       3. cart.discount_codes  (shipping codes that don't change subtotal)

     1+2 catch codes whose effect is visible immediately as money in
     the totals. 3 catches shipping-only codes (e.g. FREESHIP) whose
     effect is deferred to checkout. Adding all three (de-duped) means
     _cartHasCode() recognises a freshly-applied code regardless of
     which type it is. Automatic discounts and product compare-at sale
     prices are excluded — they don't have type 'discount_code'. */
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
        if (app && app.type === "discount_code") add(app.title);
      });
    }

    if (Array.isArray(cart.items)) {
      cart.items.forEach(function (item) {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) return;
        item.line_level_discount_allocations.forEach(function (alloc) {
          if (alloc && alloc.discount_application && alloc.discount_application.type === "discount_code") {
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
     Typically shipping discounts whose effect is deferred to checkout.
     Liquid can't render their pills server-side because cart.discount_codes
     is unreliable for manual codes; we render with JS instead. */
  function getShippingDiscountCodes(cart) {
    if (!cart || !Array.isArray(cart.discount_codes)) return [];

    var visibleSet = Object.create(null);
    if (Array.isArray(cart.cart_level_discount_applications)) {
      cart.cart_level_discount_applications.forEach(function (app) {
        if (app && app.type === "discount_code" && app.title) {
          visibleSet[String(app.title).toLowerCase()] = true;
        }
      });
    }
    if (Array.isArray(cart.items)) {
      cart.items.forEach(function (item) {
        if (!item || !Array.isArray(item.line_level_discount_allocations)) return;
        item.line_level_discount_allocations.forEach(function (alloc) {
          if (alloc && alloc.discount_application && alloc.discount_application.type === "discount_code") {
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

  function syncShippingPills(host, cart) {
    if (!host || !cart) return;
    var list = host.querySelector("[data-active-discounts]");
    if (!list) return;

    var base = "valor-cart-drawer";
    var shippingCodes = getShippingDiscountCodes(cart);
    var shippingSet = Object.create(null);
    shippingCodes.forEach(function (c) {
      shippingSet[c.toLowerCase()] = c;
    });

    list.querySelectorAll("[data-shipping-pill]").forEach(function (pill) {
      var code = pill.getAttribute("data-discount-code") || "";
      if (!shippingSet[code.toLowerCase()]) pill.parentNode && pill.parentNode.removeChild(pill);
    });

    shippingCodes.forEach(function (code) {
      var existing = list.querySelector('[data-discount-code="' + cssEscape(code) + '"]');
      if (existing) return;
      list.appendChild(buildShippingPill(host, list, code, base));
    });

    if (list.querySelector("[data-discount-code]")) {
      list.removeAttribute("hidden");
    } else {
      list.setAttribute("hidden", "");
    }

    var notice = list.parentNode ? list.parentNode.querySelector("[data-shipping-discount-notice]") : null;
    if (shippingCodes.length > 0) {
      if (!notice) {
        notice = document.createElement("p");
        notice.className = base + "__shipping-discount-notice";
        notice.setAttribute("data-shipping-discount-notice", "");
        notice.textContent = host.dataset.stringsShippingNotice || "Shipping discount will be applied at checkout.";
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
    var li = document.createElement("li");
    li.className = base + "__active-discount";
    li.setAttribute("data-discount-code", code);
    li.setAttribute("data-shipping-pill", "");

    var label = document.createElement("span");
    label.className = base + "__discount-label";

    var icon = document.createElement("span");
    icon.className = base + "__discount-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "\u2212";

    var title = document.createElement("span");
    title.className = base + "__discount-title";
    title.textContent = code;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = base + "__discount-remove";
    btn.setAttribute("data-discount-remove", "");
    btn.setAttribute("data-discount-code", code);
    var removeLabel = host.dataset.stringsRemoveDiscount || list.dataset.removeLabel || "Remove discount";
    btn.setAttribute("aria-label", removeLabel + ": " + code);
    btn.innerHTML = '<span aria-hidden="true">\u00d7</span>';
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (typeof host.removeDiscount === "function") host.removeDiscount(code);
    });

    label.appendChild(icon);
    label.appendChild(title);
    li.appendChild(label);
    li.appendChild(btn);
    return li;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (c) {
      return "\\" + c.charCodeAt(0).toString(16) + " ";
    });
  }

  /* ----- <valor-cart-drawer> custom element ----- */
  if (!customElements.get("valor-cart-drawer")) {
    customElements.define(
      "valor-cart-drawer",
      class ValorCartDrawer extends HTMLElement {
        connectedCallback() {
          // Two-tier binding:
          //   - Global events (cart icon click, ESC keyup, document
          //     valor:cart:added listener) live on long-lived hosts
          //     that don't change when the drawer's innerHTML is
          //     replaced. Bind them once, guarded by _globalBound,
          //     so re-renders don't pile up duplicate handlers.
          //   - Drawer-internal events (close buttons, discount input,
          //     quantity controls) are inside our own innerHTML and
          //     get destroyed on every re-render — they need to be
          //     re-bound after each renderFromSections() / refresh().
          if (!this._globalBound) {
            this._bindGlobalEvents();
            this._globalBound = true;
          }
          this._bindDrawerControls();

          // Page-load shipping pill sync: GET /cart.js to find any
          // shipping codes that Liquid couldn't render server-side
          // (cart.discount_codes is unreliable for manual codes).
          if (!this._shippingSynced) {
            this._shippingSynced = true;
            var self = this;
            fetch(cartUrl("cart.js"), { credentials: "same-origin" })
              .then(function (r) {
                return r.json();
              })
              .then(function (cart) {
                syncShippingPills(self, cart);
              })
              .catch(function () {});
          }
        }

        _bindGlobalEvents() {
          var self = this;

          // Esc key — bound on the host element, survives innerHTML swaps
          this.addEventListener("keyup", function (e) {
            if (e.code === "Escape") self.close();
          });

          // Cart icon lives in the header section, outside our element
          this.bindCartIcon();

          // Listen for "cart-updated" events from product forms.
          // If the event detail carries pre-rendered section HTML
          // (the bundled-section-rendering path), apply it atomically;
          // otherwise fall back to re-fetching the section. After the
          // markup is in place we trigger a single canonical cart-state
          // broadcast so product-info and other listeners get the new
          // cart without each one fetching /cart.js independently.
          // /cart/add.js doesn't include the full cart object in its
          // response, so _broadcastCartState() with no argument fetches
          // /cart.js once on everyone's behalf. refresh() handles its
          // own broadcast internally.
          document.addEventListener("valor:cart:added", function (e) {
            var detail = e && e.detail;
            if (detail && detail.sections && detail.sections[SECTION_ID]) {
              var ok = self.renderFromSections(detail.sections);
              if (ok) {
                self.open();
                self._broadcastCartState();
                return;
              }
            }
            self.refresh().then(function () {
              self.open();
            });
          });
        }

        _bindDrawerControls() {
          var self = this;

          // Close handlers — but DON'T preventDefault on links, so they navigate
          this.querySelectorAll("[data-cart-drawer-close]").forEach(function (el) {
            el.addEventListener("click", function (e) {
              // If this is a link or submit button, let it do its job
              // (close button is <button type="button"> so no default to suppress)
              var isNav = el.tagName === "A" || (el.tagName === "BUTTON" && el.type === "submit");
              if (!isNav) e.preventDefault();
              self.close();
            });
          });

          // Discount apply
          var applyBtn = this.querySelector("[data-discount-apply]");
          if (applyBtn) {
            applyBtn.addEventListener("click", function () {
              self.applyDiscount();
            });
          }
          var discountInput = this.querySelector("#ValorCartDiscountInput");
          if (discountInput) {
            discountInput.addEventListener("keydown", function (e) {
              if (e.code === "Enter") {
                e.preventDefault();
                self.applyDiscount();
              }
            });
          }

          this.querySelectorAll("[data-discount-remove]").forEach(function (button) {
            button.addEventListener("click", function (event) {
              event.preventDefault();
              var code = button.getAttribute("data-discount-code");
              if (code) self.removeDiscount(code);
            });
          });

          // Quantity controls inside the items list
          this.bindQuantityControls();
        }

        bindCartIcon() {
          var cartIcon = document.querySelector(CART_ICON_BUBBLE_SELECTOR);
          if (!cartIcon) return;
          var self = this;
          cartIcon.setAttribute("role", "button");
          cartIcon.setAttribute("aria-haspopup", "dialog");
          cartIcon.setAttribute("aria-controls", this.id);
          cartIcon.addEventListener("click", function (e) {
            e.preventDefault();
            self.open();
          });
        }

        open() {
          // Close the mobile drawer if it's open (avoid stacked drawers)
          var mobileDrawer = document.getElementById("MobileDrawer");
          if (mobileDrawer && mobileDrawer.hasAttribute("data-open")) {
            var toggleBtn = document.querySelector("[data-drawer-toggle]");
            if (toggleBtn) toggleBtn.click();
          }

          this.removeAttribute("hidden");
          // Force reflow so the slide-in transition runs from initial state
          // eslint-disable-next-line no-unused-expressions
          this.offsetWidth;
          this.setAttribute("data-open", "");
          document.body.classList.add("valor-cart-drawer-open");
        }

        close() {
          this.removeAttribute("data-open");
          document.body.classList.remove("valor-cart-drawer-open");
          var self = this;
          setTimeout(function () {
            if (!self.hasAttribute("data-open")) self.setAttribute("hidden", "");
          }, 250);
        }

        bindQuantityControls() {
          var self = this;

          // +/- buttons
          this.querySelectorAll("[data-qty-change]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var line = parseInt(btn.dataset.line, 10);
              var direction = parseInt(btn.dataset.direction, 10);
              var input = self.querySelector('[data-qty-input][data-line="' + line + '"]');
              if (!input) return;
              var newQty = Math.max(0, parseInt(input.value, 10) + direction);
              self.changeLine(line, newQty);
            });
          });

          // Direct input change (debounced)
          this.querySelectorAll("[data-qty-input]").forEach(function (input) {
            var t;
            input.addEventListener("input", function () {
              clearTimeout(t);
              t = setTimeout(function () {
                var line = parseInt(input.dataset.line, 10);
                var qty = Math.max(0, parseInt(input.value, 10) || 0);
                self.changeLine(line, qty);
              }, 500);
            });
          });

          // Remove button
          this.querySelectorAll("[data-line-remove]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var line = parseInt(btn.dataset.line, 10);
              self.changeLine(line, 0);
            });
          });
        }

        setBusy(isBusy) {
          var items = this.querySelector("valor-cart-items");
          if (items) items.setAttribute("aria-busy", isBusy ? "true" : "false");
        }

        /* Per-line quantity change. Uses bundled section rendering:
           one POST to /cart/change.js with sections=cart-drawer returns
           the cart object inline AND the freshly rendered drawer HTML
           in a single round trip. The three-fetch refresh()
           path remains the fallback when the response doesn't carry usable
           section HTML. */
        changeLine(line, quantity) {
          var self = this;
          this.setBusy(true);
          fetch(cartUrl("cart/change.js"), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              line: line,
              quantity: quantity,
              sections: SECTION_ID,
              sections_url: window.location.pathname,
            }),
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (cart) {
              // /cart/change.js returns the cart object directly. With
              // the sections parameter it also includes a sections key.
              if (cart && cart.sections && cart.sections[SECTION_ID]) {
                var ok = self.renderFromSections(cart.sections);
                if (ok) {
                  syncShippingPills(self, cart);
                  self.updateCartCount(cart);
                  self._broadcastCartState(cart);
                  self.setBusy(false);
                  return;
                }
              }
              // Fallback: section markup is missing, so re-render the drawer.
              return self.refresh();
            })
            .catch(function (err) {
              console.error("[Valor cart] change failed:", err);
              self.setBusy(false);
            });
        }

        /* Read currently-applied discount code titles from the rendered
           DOM. Each active-discount <li> carries the title in its
           data-discount-code attribute. */
        getExistingDiscountsFromDom() {
          var nodes = this.querySelectorAll("[data-active-discounts] [data-discount-code]");
          var codes = [];
          for (var i = 0; i < nodes.length; i++) {
            var c = nodes[i].getAttribute("data-discount-code");
            if (c) codes.push(c);
          }
          return codes;
        }

        applyDiscount() {
          var input = this.querySelector("#ValorCartDiscountInput");
          var msg = this.querySelector("[data-discount-message]");
          if (!input || !input.value.trim()) return;

          var code = input.value.trim();
          var self = this;
          var strAppliedTpl = this.dataset.stringsDiscountApplied || "Discount applied";
          var strInvalid = this.dataset.stringsDiscountInvalid || "Invalid discount code";
          msg.textContent = "";
          msg.removeAttribute("data-state");
          this.setBusy(true);

          // Send the existing codes plus the new one as a comma-
          // separated list. Shopify's discount parameter replaces the
          // entire set, so we must include everything we want kept.
          var existing = this.getExistingDiscountsFromDom();
          var lc = code.toLowerCase();
          var combined = existing.filter(function (c) {
            return String(c).toLowerCase() !== lc;
          });
          combined.push(code);

          fetch(cartUrl("cart/update.js"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              discount: combined.join(","),
              sections: SECTION_ID,
              sections_url: window.location.pathname,
            }),
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (cart) {
              if (cart && cart.sections && cart.sections[SECTION_ID]) {
                self.renderFromSections(cart.sections);
              }

              syncShippingPills(self, cart);

              if (self._cartHasCode(cart, code)) {
                // For shipping codes the pill + checkout-notice already
                // confirm the apply; skip the inline success message to
                // avoid three near-identical confirmations stacked
                // together. Visible codes still get the message because
                // they have no companion notice.
                var shippingCodes = getShippingDiscountCodes(cart);
                var lcCode = code.toLowerCase();
                var isShippingCode = shippingCodes.some(function (c) {
                  return String(c).toLowerCase() === lcCode;
                });

                if (!isShippingCode) {
                  msg = self.querySelector("[data-discount-message]") || msg;
                  if (msg) {
                    msg.textContent = strAppliedTpl.replace("{{ code }}", code);
                    msg.setAttribute("data-state", "success");
                  }
                }

                input = self.querySelector("#ValorCartDiscountInput") || input;
                if (input) input.value = "";
                self.updateCartCount(cart);
                self._broadcastCartState(cart);
              } else {
                msg = self.querySelector("[data-discount-message]") || msg;
                if (msg) {
                  msg.textContent = strInvalid;
                  msg.setAttribute("data-state", "error");
                }
              }
              self.setBusy(false);
            })
            .catch(function (err) {
              console.error("[Valor cart] discount failed:", err);
              if (msg) {
                msg.textContent = strInvalid;
                msg.setAttribute("data-state", "error");
              }
              self.setBusy(false);
            });
        }

        /* Remove a single applied discount code. Sends all the OTHER
           codes as a comma-separated list because Shopify's discount
           parameter replaces the entire set. */
        removeDiscount(codeToRemove) {
          var self = this;
          if (!codeToRemove) return;

          var existing = this.getExistingDiscountsFromDom();
          var lc = String(codeToRemove).toLowerCase();
          var remaining = existing.filter(function (c) {
            return String(c).toLowerCase() !== lc;
          });

          this.setBusy(true);

          fetch(cartUrl("cart/update.js"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              discount: remaining.join(","),
              sections: SECTION_ID,
              sections_url: window.location.pathname,
            }),
          })
            .then(function (r) {
              return r.json();
            })
            .then(function (cart) {
              if (cart && cart.sections && cart.sections[SECTION_ID]) {
                var ok = self.renderFromSections(cart.sections);
                if (ok) {
                  syncShippingPills(self, cart);
                  self.updateCartCount(cart);
                  self._broadcastCartState(cart);
                  self.setBusy(false);
                  return;
                }
              }
              return self.refresh();
            })
            .catch(function (err) {
              console.error("[Valor cart] discount remove failed:", err);
              self.setBusy(false);
            });
        }

        /* Apply pre-rendered section HTML returned by Shopify's bundled
           section rendering (when /cart/add.js is called with a sections
           parameter). Atomic, single-pass update — no extra fetches.

           Returns true if the drawer was successfully replaced, false
           if the response didn't contain usable HTML for our section.
           Callers should fall back to refresh() on false. */
        renderFromSections(sections) {
          if (!sections || typeof sections[SECTION_ID] !== "string") return false;

          var doc = new DOMParser().parseFromString(sections[SECTION_ID], "text/html");
          var newDrawer = doc.querySelector("#" + this.id);
          if (!newDrawer) return false;

          var wasOpen = this.hasAttribute("data-open");
          this.innerHTML = newDrawer.innerHTML;
          // Re-bind drawer-internal controls only — global events (cart
          // icon click, ESC keyup, document-level cart event listener)
          // are still attached to long-lived hosts and don't need to
          // be re-created.
          this._bindDrawerControls();
          if (wasOpen) {
            this.setAttribute("data-open", "");
            this.removeAttribute("hidden");
            document.body.classList.add("valor-cart-drawer-open");
          }
          if (newDrawer.classList.contains("valor-cart-drawer--empty")) {
            this.classList.add("valor-cart-drawer--empty");
          } else {
            this.classList.remove("valor-cart-drawer--empty");
          }

          // Update the cart-item-count attribute on the host element
          // and the header cart count bubble from the freshly rendered
          // drawer. This is atomic — the count value comes from the
          // same response that produced the new HTML, so it can never
          // get out of sync with the drawer contents.
          var newCount = newDrawer.getAttribute("data-cart-item-count");
          if (newCount != null) {
            this.setAttribute("data-cart-item-count", newCount);
            this.updateCartCount({ item_count: parseInt(newCount, 10) || 0 });
          }

          // The caller is responsible for broadcasting cart state.
          // - valor:cart:added handler doesn't have the cart object yet,
          //   so it triggers _broadcastCartState() (which fetches /cart.js).
          // - changeLine() already has the cart object in hand from
          //   /cart/change.js, so it passes it directly — no extra fetch.
          return true;
        }

        /* Single canonical cart-state broadcast point.

           When a fresh cart object is already in hand — e.g. /cart/change.js
           returns the cart inline — pass it directly and we just dispatch.
           When it isn't (the /cart/add.js response only carries the added
           item), call this with no argument and we fetch /cart.js once
           on behalf of every listener.

           The result reaches product-info, featured-product, etc. via
           the valor:cart:updated event detail, so individual components
           don't need their own /cart.js fetch after a cart mutation. */
        _broadcastCartState(cart) {
          if (cart) {
            document.dispatchEvent(new CustomEvent("valor:cart:updated", { detail: cart }));
            return Promise.resolve(cart);
          }
          return fetch(cartUrl("cart.js"), { credentials: "same-origin" })
            .then(function (r) {
              return r.json();
            })
            .then(function (c) {
              document.dispatchEvent(new CustomEvent("valor:cart:updated", { detail: c }));
              return c;
            })
            .catch(function () {
              /* fail silently; listeners can fetch on next event */
            });
        }

        /* Re-fetch the cart section and replace the drawer's inner markup.
           Also updates the header cart count bubble.

           Used as a fallback by the add-to-cart path (when bundled section
           rendering response is missing) and by the discount-apply flow.
           Per-line quantity changes use the leaner /cart/change.js +
           bundled section rendering path in changeLine(). */
        refresh() {
          var self = this;
          return fetch(cartUrl("?section_id=" + SECTION_ID))
            .then(function (r) {
              return r.text();
            })
            .then(function (html) {
              var doc = new DOMParser().parseFromString(html, "text/html");
              var newDrawer = doc.querySelector("#" + self.id);
              if (newDrawer) {
                // Preserve open state
                var wasOpen = self.hasAttribute("data-open");
                self.innerHTML = newDrawer.innerHTML;
                // Re-bind drawer-internal controls only — global events
                // (cart icon, ESC, valor:cart:added) stay bound on
                // long-lived hosts across re-renders.
                self._bindDrawerControls();
                if (wasOpen) {
                  self.setAttribute("data-open", "");
                  self.removeAttribute("hidden");
                  document.body.classList.add("valor-cart-drawer-open");
                }
                // Toggle empty class
                if (newDrawer.classList.contains("valor-cart-drawer--empty")) {
                  self.classList.add("valor-cart-drawer--empty");
                } else {
                  self.classList.remove("valor-cart-drawer--empty");
                }
              }
              // Fetch the cart state once and route it through the
              // canonical broadcaster so the bubble update + listener
              // notification happen from one place.
              return self._broadcastCartState();
            })
            .then(function (cart) {
              if (cart) {
                self.updateCartCount(cart);
              }
              self.setBusy(false);
            });
        }

        /* Check if the cart contains the given code as an applicable
           customer-applied discount. Uses the same union (cart-level
           + line-level) as getApplicableDiscountCodes() so codes
           targeting specific products are recognized. */
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

        updateCartCount(cart) {
          var cartLink = document.querySelector(CART_ICON_BUBBLE_SELECTOR);
          if (!cartLink) return;
          var bubble = cartLink.querySelector(CART_COUNT_SELECTOR);
          var count = cart.item_count;

          if (count > 0) {
            if (!bubble) {
              bubble = document.createElement("span");
              bubble.className = "valor-cart-count";
              bubble.setAttribute("aria-hidden", "true");
              cartLink.appendChild(bubble);
            }
            bubble.textContent = count < 100 ? String(count) : "";
          } else if (bubble) {
            bubble.remove();
          }
        }
      },
    );
  }

  /* ----- Product form interception -----
     Catch any submit on a form whose action posts to /cart/add and
     route it through the AJAX cart-add endpoint with bundled section
     rendering. Shopify returns the freshly rendered drawer HTML in
     the same response, which the cart drawer applies atomically.

     For known errors (out of stock, sold out, etc.) we show the
     server-supplied message inline below the buy button rather than
     falling back to the native form submit — that would dump the
     customer on the error page and lose context. Network errors
     still fall back, since the AJAX path can't reach the server. */
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form.matches || !form.matches('form[action*="/cart/add"]')) return;
    if (form.hasAttribute("data-no-ajax")) return;

    event.preventDefault();

    // Clear any previous error from a prior submit
    var errorEl = form.querySelector("[data-cart-error]");
    if (errorEl) {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }

    var formData = new FormData(form);
    // Bundled section rendering: ask Shopify to include the rendered
    // cart-drawer HTML in the response so we don't need a follow-up fetch.
    formData.append("sections", SECTION_ID);
    formData.append("sections_url", window.location.pathname);

    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.setAttribute("aria-busy", "true");

    fetch(cartUrl("cart/add.js"), {
      method: "POST",
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      body: formData,
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, body: j };
        });
      })
      .then(function (res) {
        if (submitBtn) submitBtn.removeAttribute("aria-busy");
        if (!res.ok) {
          // Shopify returns { status, message, description } on error.
          var msg = (res.body && (res.body.description || res.body.message)) || "Could not add to cart";
          document.dispatchEvent(
            new CustomEvent("valor:product-form:error", {
              detail: { form: form, body: res.body },
            }),
          );
          if (errorEl) {
            errorEl.textContent = msg;
            errorEl.hidden = false;
          } else {
            // No inline target — log only. The customer stays on the
            // page with no visible change, which is unfortunate but
            // better than reloading into Shopify's default error page.
            console.error("[Valor cart] add failed:", msg);
          }
          return;
        }
        document.dispatchEvent(new CustomEvent("valor:cart:added", { detail: res.body }));
        document.dispatchEvent(
          new CustomEvent("valor:product-form:success", {
            detail: { form: form, body: res.body },
          }),
        );
      })
      .catch(function (err) {
        if (submitBtn) submitBtn.removeAttribute("aria-busy");
        console.error("[Valor cart] add network error:", err);
        // Network failures degrade gracefully to a normal form submit
        // so the customer can still complete the purchase even if the
        // AJAX path is broken (proxy issue, lost connection, etc.).
        form.setAttribute("data-no-ajax", "");
        form.submit();
      });
  });

  window.ValorCartDrawer = { _initialized: true };
})();

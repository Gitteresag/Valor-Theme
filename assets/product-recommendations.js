/* <product-recommendations> — custom element that fetches related or
   complementary products from Shopify's recommendations API and
   replaces its own contents with the resulting markup.

   Used by:
     - sections/related-products.liquid (intent=related)
     - snippets/complementary-products.liquid, rendered as a block
       inside main-product (intent=complementary)

   Both files load this script with deferred <script> tags. On a
   typical product page the script can be requested twice (related section
   + complementary block) — the IIFE wrapper plus a customElements
   .get() guard make repeated loads safe: the class is only defined
   once, and a second <script> tag becomes a no-op.

   Behaviour:
     - On connectedCallback, immediately fetches
       /recommendations/products?section_id=...&product_id=...&limit=N&intent=...
     - The response is the fully rendered section HTML; we copy the
       inner content of its <product-recommendations> element into
       this one, which renders the cards inline.
     - If the fetch returns nothing (no recommendations available for
       this product), the surrounding wrapper stays hidden — the
       customer never sees a placeholder grid, and the page reflows
       around the absent block cleanly.
     - In Theme Editor we DO fetch, so merchants who have just set
       up complementary products in Search & Discovery see them
       immediately without reloading the storefront. The helper
       paragraph from the server-rendered empty state gets replaced
       by the fetched cards on success; on empty result, the helper
       remains visible.

   The reveal target (the wrapper hidden by default in live mode) is
   parameterised via data-reveal-host so the same element works for
   both contexts: '.valor-related-products' for the section, and
   '.valor-mp__complementary' for the block.

   Why eager fetch and not IntersectionObserver:
     The wrapper is hidden by default in live mode (only revealed if
     data arrives), so an observer wouldn't fire on a display:none
     element. Eager fetch is one extra request per product page view
     and the browser caches it on the way back. */

(function () {
  if (typeof customElements === "undefined") return;
  if (customElements.get("product-recommendations")) return;

  class ValorProductRecommendations extends HTMLElement {
    connectedCallback() {
      // Skip if already populated (e.g. recommendations.performed was true
      // on the server and the wrapper was rendered with content already).
      if (this.innerHTML.trim().length && this.dataset.loaded === "true") return;

      this._loadRecommendations();
    }

    _loadRecommendations() {
      const baseUrl = this.dataset.url;
      const productId = this.dataset.productId;
      const sectionId = this.dataset.sectionId;
      if (!baseUrl || !productId || !sectionId) return;

      const url = `${baseUrl}&product_id=${productId}&section_id=${sectionId}`;
      const self = this;

      fetch(url)
        .then(function (response) {
          if (!response.ok) throw new Error("Recommendations request failed");
          return response.text();
        })
        .then(function (text) {
          const tmp = document.createElement("div");
          tmp.innerHTML = text;
          const fresh = tmp.querySelector("product-recommendations");

          if (fresh && fresh.innerHTML.trim().length) {
            self.innerHTML = fresh.innerHTML;
            self.dataset.loaded = "true";
            // Reveal the wrapping container that was hidden by default.
            // The selector is parameterised so this element works for
            // both the related-products section and the complementary
            // block on the product page.
            const revealSelector = self.dataset.revealHost || ".valor-related-products";
            const host = self.closest(revealSelector);
            if (host) host.removeAttribute("hidden");
          }
          // If empty, leave the wrapper hidden — it stays out of view
          // for the customer and the page reflows around it cleanly.
          // In Theme Editor, the server-rendered helper paragraph
          // remains visible so merchants see the block exists.
        })
        .catch(function (err) {
          // Fail silently — a missing recommendations block is not a
          // page-breaking issue. Log only for developer visibility.
          console.error("Product recommendations failed:", err);
        });
    }
  }

  customElements.define("product-recommendations", ValorProductRecommendations);
})();

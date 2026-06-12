if (!customElements.get("valor-localization-form")) {
  customElements.define(
    "valor-localization-form",
    class ValorLocalizationForm extends HTMLElement {
      constructor() {
        super();
        this.elements = {
          input: this.querySelector('input[name="locale_code"], input[name="country_code"]'),
          button: this.querySelector(".valor-localization__select"),
          panel: this.querySelector(".valor-localization__panel"),
          search: this.querySelector('input[name="country_filter"]'),
          resetButton: this.querySelector(".valor-localization__filter-reset"),
          liveRegion: this.querySelector('[aria-live="polite"]'),
        };

        if (!this.elements.button || !this.elements.panel) return;

        this.boundOnDocumentClick = this.onDocumentClick.bind(this);

        this.addEventListener("keyup", this.onContainerKeyUp.bind(this));
        this.addEventListener("keydown", this.onContainerKeyDown.bind(this));
        this.elements.button.addEventListener("click", this.toggleSelector.bind(this));

        if (this.elements.search) {
          this.elements.search.addEventListener("input", this.filterCountries.bind(this));
          this.elements.search.addEventListener("keydown", this.onSearchKeyDown.bind(this));
        }
        if (this.elements.resetButton) {
          this.elements.resetButton.addEventListener("click", this.resetFilter.bind(this));
          this.elements.resetButton.addEventListener("mousedown", function (event) {
            event.preventDefault();
          });
        }

        var self = this;
        this.querySelectorAll("a").forEach(function (item) {
          item.addEventListener("click", self.onItemClick.bind(self));
        });
      }

      isOpen() {
        return this.elements.button.getAttribute("aria-expanded") === "true";
      }

      openSelector() {
        this.elements.button.setAttribute("aria-expanded", "true");
        this.elements.panel.removeAttribute("hidden");
        document.addEventListener("click", this.boundOnDocumentClick);
        if (this.elements.search && window.matchMedia("(min-width: 750px)").matches) {
          this.elements.search.focus();
        }
      }

      closeSelector() {
        this.elements.button.setAttribute("aria-expanded", "false");
        this.elements.panel.setAttribute("hidden", "");
        document.removeEventListener("click", this.boundOnDocumentClick);
        if (this.elements.search) {
          this.elements.search.value = "";
          this.filterCountries();
        }
      }

      toggleSelector(event) {
        event.preventDefault();
        if (this.isOpen()) {
          this.closeSelector();
        } else {
          this.openSelector();
        }
      }

      onDocumentClick(event) {
        if (!this.contains(event.target)) {
          this.closeSelector();
        }
      }

      onContainerKeyDown(event) {
        var focusableItems = Array.prototype.slice.call(this.querySelectorAll("a")).filter(function (item) {
          return !item.parentElement.classList.contains("hidden");
        });
        var focusedIndex = focusableItems.indexOf(document.activeElement);
        var itemToFocus;

        switch (event.code.toUpperCase()) {
          case "ARROWUP":
            event.preventDefault();
            itemToFocus =
              focusedIndex > 0 ? focusableItems[focusedIndex - 1] : focusableItems[focusableItems.length - 1];
            if (itemToFocus) itemToFocus.focus();
            break;
          case "ARROWDOWN":
            event.preventDefault();
            itemToFocus =
              focusedIndex < focusableItems.length - 1 ? focusableItems[focusedIndex + 1] : focusableItems[0];
            if (itemToFocus) itemToFocus.focus();
            break;
        }
      }

      onContainerKeyUp(event) {
        if (event.code.toUpperCase() === "ESCAPE") {
          if (!this.isOpen()) return;
          this.closeSelector();
          event.stopPropagation();
          this.elements.button.focus();
        }
      }

      onItemClick(event) {
        event.preventDefault();
        var form = this.querySelector("form");
        this.elements.input.value = event.currentTarget.dataset.value;
        if (form) form.submit();
      }

      normalizeString(str) {
        return str
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase();
      }

      filterCountries() {
        if (!this.elements.search) return;

        var searchValue = this.normalizeString(this.elements.search.value);
        var popularList = this.querySelector(".valor-localization__list--popular");
        var allCountryLinks = this.querySelectorAll(".valor-localization__list--countries a");
        var visibleCount = 0;

        if (this.elements.resetButton) {
          this.elements.resetButton.classList.toggle("hidden", !searchValue);
        }
        if (popularList) {
          popularList.classList.toggle("hidden", !!searchValue);
        }

        var self = this;
        allCountryLinks.forEach(function (link) {
          var nameEl = link.querySelector(".valor-localization__country-name");
          if (!nameEl) return;
          var name = self.normalizeString(nameEl.textContent);
          var match = name.indexOf(searchValue) > -1;
          link.parentElement.classList.toggle("hidden", !match);
          if (match) visibleCount++;
        });

        if (this.elements.liveRegion) {
          this.elements.liveRegion.textContent = visibleCount + " results";
        }

        var listWrapper = this.querySelector(".valor-localization__list-wrapper");
        if (listWrapper) listWrapper.scrollTop = 0;
      }

      resetFilter(event) {
        event.stopPropagation();
        this.elements.search.value = "";
        this.filterCountries();
        this.elements.search.focus();
      }

      onSearchKeyDown(event) {
        if (event.code.toUpperCase() === "ENTER") {
          event.preventDefault();
        }
      }
    },
  );
}

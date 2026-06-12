/**
 * <button is="valor-back-to-top">
 * Shows the button after the user has scrolled past a threshold,
 * scrolls smoothly back to top on click. Respects prefers-reduced-motion.
 */
class ValorBackToTop extends HTMLButtonElement {
  constructor() {
    super();
    this.threshold = 400; // pixels scrolled before button appears
    this.handleScroll = this.onScroll.bind(this);
    this.handleClick = this.onClick.bind(this);
  }

  connectedCallback() {
    this.removeAttribute("hidden");
    this.addEventListener("click", this.handleClick);
    window.addEventListener("scroll", this.handleScroll, { passive: true });
    this.onScroll(); // initial state in case page loads scrolled
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.handleClick);
    window.removeEventListener("scroll", this.handleScroll);
  }

  onScroll() {
    const scrolled = window.scrollY || window.pageYOffset;
    if (scrolled > this.threshold) {
      this.classList.add("is-visible");
    } else {
      this.classList.remove("is-visible");
    }
  }

  onClick() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: 0,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }
}

if (!customElements.get("valor-back-to-top")) {
  customElements.define("valor-back-to-top", ValorBackToTop, { extends: "button" });
}

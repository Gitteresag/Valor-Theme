/**
 * <valor-back-to-top> — autonomous custom element wrapping a real <button>.
 *
 * Autonomous (not `<button is="...">`) because Safari/WebKit never shipped
 * customized built-in elements, so an `is=` button would never upgrade there
 * and the button would never appear. The wrapper is layout-neutral
 * (display: contents); the inner <button> keeps all styling and positioning.
 *
 * Shows the button after the user has scrolled past a threshold, scrolls
 * smoothly back to top on click. Respects prefers-reduced-motion.
 */
class ValorBackToTop extends HTMLElement {
  constructor() {
    super();
    this.threshold = 400; // pixels scrolled before button appears
    this.handleScroll = this.onScroll.bind(this);
    this.handleClick = this.onClick.bind(this);
  }

  connectedCallback() {
    this.button = this.querySelector("button");
    if (!this.button) return;
    this.button.removeAttribute("hidden");
    this.button.addEventListener("click", this.handleClick);
    window.addEventListener("scroll", this.handleScroll, { passive: true });
    this.onScroll(); // initial state in case page loads scrolled
  }

  disconnectedCallback() {
    if (this.button) this.button.removeEventListener("click", this.handleClick);
    window.removeEventListener("scroll", this.handleScroll);
  }

  onScroll() {
    if (!this.button) return;
    const scrolled = window.scrollY || window.pageYOffset;
    this.button.classList.toggle("is-visible", scrolled > this.threshold);
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
  customElements.define("valor-back-to-top", ValorBackToTop);
}

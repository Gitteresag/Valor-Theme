(function () {
  'use strict';

  if (customElements.get('valor-slideshow')) return;

  class ValorSlideshow extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;

      this.slides = Array.prototype.slice.call(this.querySelectorAll('[data-slide]'));
      this.dots = Array.prototype.slice.call(this.querySelectorAll('[data-slide-dot]'));
      this.previousButton = this.querySelector('[data-slide-previous]');
      this.nextButton = this.querySelector('[data-slide-next]');
      this.autoplay = this.dataset.autoplay === 'true';
      this.interval = Math.max(parseInt(this.dataset.interval, 10) || 5000, 3000);
      this.currentIndex = Math.max(this.slides.findIndex(function (slide) { return !slide.hidden; }), 0);
      this.timer = null;
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (this.slides.length < 2) return;

      this.bindEvents();
      this.show(this.currentIndex);
      this.startAutoplay();
    }

    disconnectedCallback() {
      this.stopAutoplay();
    }

    bindEvents() {
      if (this.previousButton) {
        this.previousButton.addEventListener('click', this.previous.bind(this));
      }

      if (this.nextButton) {
        this.nextButton.addEventListener('click', this.next.bind(this));
      }

      this.dots.forEach(function (dot) {
        dot.addEventListener('click', function () {
          this.show(Number(dot.dataset.slideDot));
          this.restartAutoplay();
        }.bind(this));
      }.bind(this));

      this.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          this.previous();
        }

        if (event.key === 'ArrowRight') {
          event.preventDefault();
          this.next();
        }
      }.bind(this));

      this.addEventListener('mouseenter', this.stopAutoplay.bind(this));
      this.addEventListener('mouseleave', this.startAutoplay.bind(this));
      this.addEventListener('focusin', this.stopAutoplay.bind(this));
      this.addEventListener('focusout', this.startAutoplay.bind(this));

      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          this.stopAutoplay();
        } else {
          this.startAutoplay();
        }
      }.bind(this));
    }

    previous() {
      this.show(this.currentIndex - 1);
      this.restartAutoplay();
    }

    next() {
      this.show(this.currentIndex + 1);
      this.restartAutoplay();
    }

    show(index) {
      var nextIndex = (index + this.slides.length) % this.slides.length;
      this.currentIndex = nextIndex;

      this.slides.forEach(function (slide, slideIndex) {
        var isActive = slideIndex === nextIndex;
        slide.hidden = !isActive;
        slide.classList.toggle('is-active', isActive);
        slide.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });

      this.dots.forEach(function (dot, dotIndex) {
        dot.setAttribute('aria-pressed', dotIndex === nextIndex ? 'true' : 'false');
      });
    }

    startAutoplay() {
      if (!this.autoplay || this.reducedMotion || this.slides.length < 2 || this.timer) return;
      this.timer = window.setInterval(this.next.bind(this), this.interval);
    }

    stopAutoplay() {
      if (!this.timer) return;
      window.clearInterval(this.timer);
      this.timer = null;
    }

    restartAutoplay() {
      this.stopAutoplay();
      this.startAutoplay();
    }
  }

  customElements.define('valor-slideshow', ValorSlideshow);
})();

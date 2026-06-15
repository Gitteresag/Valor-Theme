(function () {
  "use strict";

  if (customElements.get("valor-slideshow")) return;

  class ValorSlideshow extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;

      this.viewport = this.querySelector("[data-slideshow-viewport]");
      this.slides = Array.prototype.slice.call(this.querySelectorAll("[data-slide]"));
      this.dots = Array.prototype.slice.call(this.querySelectorAll("[data-slide-dot]"));
      this.autoplay = this.dataset.autoplay === "true";
      this.interval = Math.max(parseInt(this.dataset.interval, 10) || 5000, 3000);
      this.pauseOnHover = this.dataset.pauseOnHover !== "false";
      this.currentIndex = Math.max(
        this.slides.findIndex(function (slide) {
          return slide.classList.contains("is-active");
        }),
        0,
      );
      this.timer = null;
      this.scrollFrame = null;
      this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.abortController = new AbortController();

      this.onScroll = this.onScroll.bind(this);
      this.onResize = this.onResize.bind(this);
      this.onKeydown = this.onKeydown.bind(this);
      this.onVisibilityChange = this.onVisibilityChange.bind(this);
      this.stopAutoplay = this.stopAutoplay.bind(this);
      this.startAutoplay = this.startAutoplay.bind(this);
      this.onBlockSelect = this.onBlockSelect.bind(this);
      this.onBlockDeselect = this.onBlockDeselect.bind(this);

      if (!this.viewport || this.slides.length === 0) return;

      this.bindEvents();
      this.update(this.currentIndex);
      this.scrollToSlide(this.currentIndex, true);
      this.startAutoplay();
    }

    disconnectedCallback() {
      this.stopAutoplay();
      if (this.abortController) this.abortController.abort();
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.scrollFrame) window.cancelAnimationFrame(this.scrollFrame);
      this.initialized = false;
    }

    bindEvents() {
      var signal = this.abortController.signal;

      this.dots.forEach(
        function (dot) {
          dot.addEventListener(
            "click",
            function () {
              this.show(Number(dot.dataset.slideDot));
              this.restartAutoplay();
            }.bind(this),
            { signal: signal },
          );
        }.bind(this),
      );

      this.viewport.addEventListener("scroll", this.onScroll, { passive: true, signal: signal });
      window.addEventListener("resize", this.onResize, { signal: signal });
      document.addEventListener("visibilitychange", this.onVisibilityChange, { signal: signal });
      this.addEventListener("keydown", this.onKeydown, { signal: signal });
      this.addEventListener("focusin", this.stopAutoplay, { signal: signal });
      this.addEventListener("focusout", this.startAutoplay, { signal: signal });

      if (this.pauseOnHover) {
        this.addEventListener("mouseenter", this.stopAutoplay, { signal: signal });
        this.addEventListener("mouseleave", this.startAutoplay, { signal: signal });
      }

      if (window.ResizeObserver) {
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(this.viewport);
      }

      if (window.Shopify && window.Shopify.designMode) {
        document.addEventListener("shopify:block:select", this.onBlockSelect, { signal: signal });
        document.addEventListener("shopify:block:deselect", this.onBlockDeselect, { signal: signal });
      }
    }

    onKeydown(event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.previous();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        this.next();
      }
    }

    previous(event) {
      if (event) event.preventDefault();
      this.show(this.currentIndex - 1);
      this.restartAutoplay();
    }

    next(event) {
      if (event) event.preventDefault();
      this.show(this.currentIndex + 1);
      this.restartAutoplay();
    }

    show(index, instant) {
      if (this.slides.length < 1) return;
      var nextIndex = this.normalizeIndex(index);
      this.update(nextIndex);
      this.scrollToSlide(nextIndex, instant);
    }

    normalizeIndex(index) {
      return (index + this.slides.length) % this.slides.length;
    }

    scrollToSlide(index, instant) {
      var slide = this.slides[index];
      if (!slide || !this.viewport) return;

      var left = slide.offsetLeft - this.slides[0].offsetLeft;
      var useInstantScroll = instant || this.reducedMotionQuery.matches;

      this.viewport.scrollTo({
        left: left,
        behavior: useInstantScroll ? "auto" : "smooth",
      });
    }

    onScroll() {
      if (this.scrollFrame) window.cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = window.requestAnimationFrame(
        function () {
          this.scrollFrame = null;
          this.update(this.getClosestSlideIndex());
        }.bind(this),
      );
    }

    getClosestSlideIndex() {
      if (!this.viewport || this.slides.length < 2) return 0;

      var viewportLeft = this.viewport.scrollLeft;
      var firstOffset = this.slides[0].offsetLeft;
      var closestIndex = 0;
      var closestDistance = Infinity;

      this.slides.forEach(function (slide, index) {
        var slideLeft = slide.offsetLeft - firstOffset;
        var distance = Math.abs(slideLeft - viewportLeft);

        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      return closestIndex;
    }

    update(index) {
      this.currentIndex = index;

      this.slides.forEach(function (slide, slideIndex) {
        var isActive = slideIndex === index;
        slide.classList.toggle("is-active", isActive);
        slide.setAttribute("aria-hidden", isActive ? "false" : "true");
        slide.setAttribute("tabindex", isActive ? "0" : "-1");

        slide.querySelectorAll("a, button, input, select, textarea").forEach(function (element) {
          if (isActive) {
            element.removeAttribute("tabindex");
          } else {
            element.setAttribute("tabindex", "-1");
          }
        });
      });

      this.dots.forEach(function (dot, dotIndex) {
        var isActive = dotIndex === index;
        dot.setAttribute("aria-pressed", isActive ? "true" : "false");

        if (isActive) {
          dot.setAttribute("aria-current", "true");
        } else {
          dot.removeAttribute("aria-current");
        }
      });
    }

    onResize() {
      this.scrollToSlide(this.currentIndex, true);
    }

    onVisibilityChange() {
      if (document.hidden) {
        this.stopAutoplay();
      } else {
        this.startAutoplay();
      }
    }

    onBlockSelect(event) {
      var slide = event.target && event.target.closest ? event.target.closest("[data-slide]") : null;
      var index = this.slides.indexOf(slide);

      if (index < 0 || !this.contains(slide)) return;
      this.stopAutoplay();
      this.show(index, true);
    }

    onBlockDeselect(event) {
      var slide = event.target && event.target.closest ? event.target.closest("[data-slide]") : null;

      if (!slide || !this.contains(slide)) return;
      this.startAutoplay();
    }

    startAutoplay() {
      if (!this.autoplay || this.reducedMotionQuery.matches || this.slides.length < 2 || this.timer) return;
      this.viewport.setAttribute("aria-live", "off");
      this.timer = window.setInterval(
        function () {
          this.show(this.currentIndex + 1);
        }.bind(this),
        this.interval,
      );
    }

    stopAutoplay() {
      if (!this.timer) return;
      window.clearInterval(this.timer);
      this.timer = null;
      if (this.viewport) this.viewport.setAttribute("aria-live", "polite");
    }

    restartAutoplay() {
      this.stopAutoplay();
      this.startAutoplay();
    }
  }

  customElements.define("valor-slideshow", ValorSlideshow);
})();

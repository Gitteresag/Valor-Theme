/**
 * <div is="valor-video">
 *
 * Handles two play modes:
 *  1. Cover image visible → click play hides cover, reveals video, starts playback.
 *  2. No cover (Shopify-hosted video, play button on) → toggle button pauses/plays.
 *
 * For YouTube and Vimeo iframes, click on the cover swaps the iframe src
 * with autoplay=1 so the video starts immediately (avoids needing the
 * full provider SDK just to trigger play).
 */
class ValorVideo extends HTMLDivElement {
  constructor() {
    super();
    this._handlePlayClick = this.onPlayClick.bind(this);
    this._handleToggleClick = this.onToggleClick.bind(this);
  }

  connectedCallback() {
    this.coverEl = this.querySelector('[data-video-cover]');
    this.mediaEl = this.querySelector('[data-video-media]');
    this.playBtn = this.querySelector('[data-video-play]');
    this.toggleBtn = this.querySelector('[data-video-toggle]');
    this.mute = this.dataset.mute === 'true';

    if (this.playBtn) this.playBtn.addEventListener('click', this._handlePlayClick);
    if (this.toggleBtn) this.toggleBtn.addEventListener('click', this._handleToggleClick);
  }

  onPlayClick() {
    // Hide cover, show media
    if (this.coverEl) this.coverEl.setAttribute('hidden', '');
    if (this.mediaEl) this.mediaEl.removeAttribute('hidden');

    // Trigger playback based on what's inside .valor-video__media
    const native = this.querySelector('video');
    const iframe = this.querySelector('iframe');

    if (native) {
      if (!this.mute) native.muted = false;
      native.play().catch(() => {
        // Autoplay with sound was blocked → fall back to muted
        native.muted = true;
        native.play().catch(() => { /* user gesture required */ });
      });
    } else if (iframe) {
      // Add autoplay=1 (and mute=1 if needed) to the iframe URL to start playback
      try {
        const url = new URL(iframe.src);
        url.searchParams.set('autoplay', '1');
        if (this.mute) {
          // YouTube uses mute=1, Vimeo uses muted=1
          if (url.hostname.indexOf('youtube') !== -1) url.searchParams.set('mute', '1');
          if (url.hostname.indexOf('vimeo') !== -1) url.searchParams.set('muted', '1');
        }
        iframe.src = url.toString();
      } catch (e) {
        // If src isn't a valid URL for some reason, leave as-is
      }
    }

    this.setAttribute('data-playing', 'true');
  }

  onToggleClick() {
    const native = this.querySelector('video');
    if (!native) return;

    if (native.paused) {
      if (!this.mute) native.muted = false;
      native.play().then(() => {
        this.setAttribute('data-playing', 'true');
      }).catch(() => {
        // Sound blocked — retry muted
        native.muted = true;
        native.play();
        this.setAttribute('data-playing', 'true');
      });
    } else {
      native.pause();
      this.removeAttribute('data-playing');
    }
  }
}

if (!customElements.get('valor-video')) {
  customElements.define('valor-video', ValorVideo, { extends: 'div' });
}

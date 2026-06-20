class ValorCountdownTimer extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;

    this.daysEl = this.querySelector("[data-countdown-days]");
    this.hoursEl = this.querySelector("[data-countdown-hours]");
    this.minutesEl = this.querySelector("[data-countdown-minutes]");
    this.secondsEl = this.querySelector("[data-countdown-seconds]");
    this.expiredEl = this.querySelector("[data-countdown-expired]");
    this.timerEl = this.querySelector("[data-countdown-values]");
    this.summaryEl = this.querySelector("[data-countdown-summary]");
    this.lastSummaryText = "";
    this.targetDate = this.parseTargetDate();

    if (!this.targetDate) {
      this.handleExpired();
      return;
    }

    this.update();
    this.interval = window.setInterval(() => this.update(), 1000);
  }

  disconnectedCallback() {
    if (this.interval) {
      window.clearInterval(this.interval);
    }
  }

  parseTargetDate() {
    const date = (this.dataset.endDate || "").trim();
    let time = (this.dataset.endTime || "23:59").trim();
    let offset = (this.dataset.timezoneOffset || "+00:00").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    // Accept single-digit hours (e.g. "9:00", "+2:00") by padding to the
    // two-digit form the Date constructor needs, so a small merchant typo
    // doesn't silently expire the timer on load.
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) return null;
    time = timeMatch[1].padStart(2, "0") + ":" + timeMatch[2];
    const offsetMatch = offset.match(/^([+-])(\d{1,2}):(\d{2})$/);
    if (!offsetMatch) return null;
    offset = offsetMatch[1] + offsetMatch[2].padStart(2, "0") + ":" + offsetMatch[3];

    const target = new Date(`${date}T${time}:00${offset}`);
    return Number.isNaN(target.getTime()) ? null : target;
  }

  update() {
    const diff = this.targetDate.getTime() - Date.now();
    if (diff <= 0) {
      this.handleExpired();
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    this.setValue(this.daysEl, days);
    this.setValue(this.hoursEl, hours);
    this.setValue(this.minutesEl, minutes);
    this.setValue(this.secondsEl, seconds);
    this.updateSummary(days, hours, minutes);
  }

  setValue(element, value) {
    if (!element) return;
    element.textContent = String(value).padStart(2, "0");
  }

  updateSummary(days, hours, minutes) {
    if (!this.summaryEl) return;

    const parts = [];
    if (days > 0) parts.push(days + " " + this.pluralize(days, "day"));
    if (hours > 0) parts.push(hours + " " + this.pluralize(hours, "hour"));
    if (days === 0 && minutes > 0) parts.push(minutes + " " + this.pluralize(minutes, "minute"));

    const timeText = parts.length ? parts.join(", ") : this.dataset.summaryUnderMinute || "under 1 minute";
    const template = this.dataset.summaryTemplate || "Promotion ends in __TIME__.";
    const text = template.replace("__TIME__", timeText);

    if (text === this.lastSummaryText) return;
    this.lastSummaryText = text;
    this.summaryEl.textContent = text;
  }

  pluralize(value, unit) {
    const suffix = value === 1 ? "One" : "Other";
    return this.dataset[unit + suffix] || unit;
  }

  handleExpired() {
    if (this.interval) {
      window.clearInterval(this.interval);
      this.interval = null;
    }

    if (this.dataset.expiredBehavior === "hide") {
      this.hidden = true;
      return;
    }

    if (this.timerEl) this.timerEl.hidden = true;
    if (this.summaryEl) this.summaryEl.textContent = "";
    if (this.expiredEl) this.expiredEl.hidden = false;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("valor-countdown-timer")) {
  customElements.define("valor-countdown-timer", ValorCountdownTimer);
}

/* Optional website pageviews. App analytics are a separate service. */
(() => {
  'use strict';
  const key = 'activiews.umami-consent.v1';
  const sessionKey = `${key}.blocked`;
  let choice = null;
  let blocked = false;
  let script;
  let lastPath;
  let channel;
  try { blocked = sessionStorage.getItem(sessionKey) === 'true'; } catch { /* Fail closed below. */ }

  const banner = document.createElement('section');
  banner.id = 'analytics-banner';
  banner.className = 'analytics-banner';
  banner.setAttribute('aria-labelledby', 'analytics-heading');
  banner.innerHTML = `
    <div class="analytics-copy">
      <h2 id="analytics-heading">Optional analytics</h2>
      <p>Allow basic pageviews to help improve this website? Declining does not affect access.
        <a href="privacy.html#website-analytics">Privacy notice</a></p>
    </div>
    <div class="analytics-actions">
      <button type="button" class="analytics-choice analytics-allow">Allow analytics</button>
      <button type="button" class="analytics-choice analytics-decline">Decline</button>
    </div>`;
  document.body.append(banner);
  const status = document.createElement('p');
  status.className = 'analytics-status';
  status.setAttribute('role', 'status');
  document.querySelector('.footer-links').after(status);
  const preferences = document.querySelector('[data-analytics-preferences]');
  preferences.hidden = false;
  const allow = banner.querySelector('.analytics-allow');
  const decline = banner.querySelector('.analytics-decline');

  function readChoice() {
    try {
      const value = localStorage.getItem(key);
      return value === 'accepted' || value === 'declined' ? value : null;
    } catch { return null; }
  }

  function permitted() {
    return !blocked && choice === 'accepted' && readChoice() === 'accepted';
  }

  function cleanAddress(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin ? url.pathname : url.origin + url.pathname;
    } catch { return ''; }
  }

  // The SDK calls this for every send, even after it has loaded or queued work.
  // Whitelist basic pageview fields; refuse custom events and other send types.
  window.activiewsUmamiBeforeSend = (type, payload) => {
    if (!permitted() || type !== 'event' || payload.name) return false;
    return {
      website: 'e3de4eca-b42f-42de-afc0-b8e267bc1ca7',
      hostname: location.hostname,
      url: cleanAddress(payload.url),
      referrer: cleanAddress(payload.referrer),
      title: document.title,
      language: navigator.language,
      screen: `${screen.width}x${screen.height}`,
    };
  };

  function pageview() {
    if (!permitted() || !window.umami || lastPath === location.pathname) return;
    lastPath = location.pathname;
    // Handle SDK failures (including storage becoming unavailable after loading).
    try {
      Promise.resolve(window.umami.track(props => ({ ...props, url: location.pathname })))
        .catch(() => { lastPath = undefined; });
    } catch { lastPath = undefined; }
  }

  function start() {
    if (!permitted()) return;
    if (script) { pageview(); return; }
    script = document.createElement('script');
    script.defer = true;
    script.src = 'https://analytics.ahmeto.com/script.js';
    script.dataset.websiteId = 'e3de4eca-b42f-42de-afc0-b8e267bc1ca7';
    // Manual pageviews avoid SDK click handlers, SPA timers and optional features.
    script.dataset.autoTrack = 'false';
    script.dataset.excludeSearch = 'true';
    script.dataset.excludeHash = 'true';
    script.dataset.beforeSend = 'activiewsUmamiBeforeSend';
    script.referrerPolicy = 'no-referrer';
    script.onload = pageview;
    script.onerror = () => { script.remove(); script = undefined; };
    document.head.append(script);
  }

  function render() {
    banner.hidden = choice !== null;
    preferences.setAttribute('aria-expanded', String(!banner.hidden));
    if (!permitted()) lastPath = undefined;
    else start();
  }

  function choose(value) {
    // Block synchronously, before attempting any persistence or SDK work.
    blocked = true;
    choice = value;
    let saved = false;
    try {
      localStorage.setItem(key, value);
      saved = localStorage.getItem(key) === value;
    } catch { /* Keep this document blocked if storage cannot save the choice. */ }
    blocked = value !== 'accepted' || !saved;
    try {
      if (blocked) sessionStorage.setItem(sessionKey, 'true');
      else sessionStorage.removeItem(sessionKey);
    } catch { /* The in-memory block does not depend on storage. */ }
    status.textContent = saved
      ? (value === 'accepted' ? 'Analytics allowed.' : 'Analytics declined.')
      : 'Your preference could not be saved. Analytics remain blocked on this page. Your browser may ask again or use an older choice on a later visit.';
    channel?.postMessage({ choice: saved ? value : 'declined' });
    render();
    preferences.focus({ preventScroll: true });
  }

  allow.addEventListener('click', () => choose('accepted'));
  decline.addEventListener('click', () => choose('declined'));
  preferences.addEventListener('click', () => {
    banner.hidden = false;
    preferences.setAttribute('aria-expanded', 'true');
    allow.focus();
  });

  function sync() {
    choice = readChoice();
    // A successful explicit acceptance in another tab can clear a session block.
    blocked = choice !== 'accepted';
    try {
      if (blocked) sessionStorage.setItem(sessionKey, 'true');
      else sessionStorage.removeItem(sessionKey);
    } catch { /* Memory remains authoritative for this document. */ }
    render();
  }
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) sync();
  });
  try {
    channel = new BroadcastChannel(key);
    channel.onmessage = ({ data }) => {
      if (data?.choice === 'accepted') sync();
      else if (data?.choice === 'declined') {
        choice = 'declined';
        blocked = true;
        try { sessionStorage.setItem(sessionKey, 'true'); } catch { /* Memory fallback. */ }
        render();
      }
    };
  } catch { /* Storage events still synchronize saved preferences. */ }

  // This site uses full-page links; also guard history navigation for future SPA use.
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      pageview();
      return result;
    };
  }
  window.addEventListener('popstate', pageview);
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      choice = readChoice();
      render();
    }
  });
  choice = blocked ? 'declined' : readChoice();
  render();
})();

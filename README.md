# Activiews website

Static HTML and shared CSS, served directly without a framework, compilation, or production build step. Publish the four root HTML files and `assets/` using the existing static hosting configuration; test tooling is not part of the website runtime.

## Optional website analytics

`assets/analytics.js` loads the self-hosted Umami script only after explicit, successfully saved consent. It sends basic pageviews, with automatic SDK tracking disabled. Its before-send hook checks consent again, allows only basic pageview fields, and strips queries and fragments from page and referrer addresses. History navigation is covered by the same gate. A loaded SDK remains inert after withdrawal; stopping tracking does not depend on removing a script or reloading.

Preferences use `activiews.umami-consent.v1` in local storage. Rejection is remembered too. Storage events synchronize saved changes; BroadcastChannel also communicates a failed withdrawal save to already open tabs. A session-storage block is attempted as a fallback. If all storage is unavailable, the current document stays blocked without reloading, but that in-memory decision cannot survive a full navigation or browser restart; the UI reports this limitation. An unsaved acceptance never enables analytics.

The linked website section in `privacy.html` covers hosting, indefinite retention, preferences and withdrawal. Existing iOS app Firebase disclosures are separate and retained.

## Verification

Requires Node.js, Python 3 and installed Google Chrome.

```sh
npm ci
npm run check
npm test
```

Playwright serves the unchanged static production files locally. Tests fetch the hosted SDK code and intercept **every** browser request to the analytics host, fulfilling pageview submissions locally so tests do not enter production statistics. Tests require network access to download the SDK; they fail rather than substitute a mock tracker. Screenshots are written under ignored `test-results/`.

There is no production build, lint or typecheck pipeline in this static project. `npm run check` validates the shared controller's syntax, and `npm test` verifies the served production files in real Chromium (Google Chrome).

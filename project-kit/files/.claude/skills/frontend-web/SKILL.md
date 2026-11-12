---
name: frontend-web
description: The web-specific deltas on top of frontend - secrets, escaping and token storage in a browser bundle, responsive and server-rendered layout, SEO, and web performance. Use together with frontend when the target is a web UI.
when_to_use: web page, browser, React, Vue, Next.js, SSR, responsive layout, SEO, web performance
---

# Frontend — web

The web deltas on top of `frontend` (render every state, values from the source,
typed API calls, the shared security model). Load both for a web task; this file
adds only what the browser changes.

## Workflow

```
Web delta:
- [ ] 1. Raw-HTML sinks only with sanitized input; token in an httpOnly cookie by default; CSP not widened
- [ ] 2. Responsive at the widths the design names; server and client render the same states
- [ ] 3. Performance budget checked (bundle, images, layout shift)
```

## Start when

The target is a web UI — a browser, or a web view. A mobile-native target → use
`frontend-mobile` instead.

## Security in a browser bundle

- A **build-time public prefix** (`NEXT_PUBLIC_*`, `VITE_*`) is inlined into the
  bundle every browser downloads; no secret goes there — it goes behind a server
  route.
- **Raw-HTML sinks** (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`) only
  through the sanitiser the project names; none named, do not use them.
- **Auth token**: default an httpOnly cookie set by the server; `localStorage` is
  readable by any script on the page, so a token there is one XSS away from theft.
- **Content-Security-Policy** as the project sets it; do not widen it to make a
  resource load.

## Layout and rendering

- **Responsive** to the widths the design names; no fixed-pixel layout that breaks
  on a phone-width browser.
- **Server-rendered or hydrated** UI keeps the same states on the server and the
  client; a mismatch is a hydration bug, not a cosmetic one.
- The document **title and meta** come from the content, for SEO and link
  previews, where the feature calls for it.

## Performance

Lazy-load images with explicit dimensions so the layout does not shift; split a
heavy component with a dynamic import; do not block the main thread with work that
belongs in a worker or the server.

## Output

Folds into the `frontend` report: the web screens built, and any web-specific
secret, sanitiser, CSP or hydration concern surfaced
(Communication, Report of finished work).

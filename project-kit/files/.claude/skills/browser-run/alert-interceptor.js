/**
 * Site-agnostic alert / toast interceptor.
 * Injected on every page (addInitScript) before any app code runs. It watches
 * for ephemeral UI feedback without knowing the app's CSS or framework, using
 * ARIA live regions/roles, short-lived overlay nodes, and native dialogs.
 * Read (and clear) with window.__qaReadAlerts().
 *
 * Adapted from the qa-crawler toast-interceptor; trimmed and made self-contained.
 */
(function () {
  if (window.__qaInterceptorInstalled) return;
  window.__qaInterceptorInstalled = true;
  window.__qaAlerts = [];

  function textOf(n) { return (n.innerText || n.textContent || '').trim().slice(0, 300); }
  function classify(n) {
    const t = textOf(n);
    if (!t || t.length < 2) return null;
    const role = n.getAttribute && n.getAttribute('role') || '';
    const live = n.getAttribute && n.getAttribute('aria-live') || '';
    const blob = (t + ' ' + (n.className || '') + ' ' + role + ' ' +
      (n.getAttribute && (n.getAttribute('data-type') || n.getAttribute('data-variant') || '') || '')).toLowerCase();
    let type = 'info';
    if (/error|danger|fail|invalid|wrong|incorrect|denied/.test(blob)) type = 'error';
    else if (/success|saved|created|updated|deleted|complete|added/.test(blob)) type = 'success';
    else if (/warn/.test(blob)) type = 'warning';
    return { text: t, type, role: role || live || 'node', at: Date.now() };
  }
  function push(a) {
    if (!a) return;
    const last = window.__qaAlerts[window.__qaAlerts.length - 1];
    if (last && last.text === a.text && a.at - last.at < 500) return; // dedupe
    window.__qaAlerts.push(a);
  }

  // 1. ARIA live regions / alert roles (most reliable, framework-agnostic)
  try {
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const role = node.getAttribute && node.getAttribute('role');
          const live = node.getAttribute && node.getAttribute('aria-live');
          if (role === 'alert' || role === 'status' || live === 'assertive' || live === 'polite') push(classify(node));
          // 2. Ephemeral overlay: fixed/absolute high-z node that is removed within 8s
          try {
            const s = getComputedStyle(node);
            if ((s.position === 'fixed' || s.position === 'absolute') && (parseInt(s.zIndex) || 0) > 100) {
              const a = classify(node);
              if (a) { setTimeout(() => { if (!document.contains(node)) push(a); }, 100); }
            }
          } catch (e) {}
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  // 3. Native dialogs surfaced as alerts too (console errors are read separately via page.on)
  window.__qaReadAlerts = function () {
    const out = window.__qaAlerts.slice();
    window.__qaAlerts = [];
    return out;
  };
})();

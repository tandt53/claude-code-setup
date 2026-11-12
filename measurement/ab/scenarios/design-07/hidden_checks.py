"""Hidden checks for design-07, one per point of spec.md. Never shown to the agent.

The new function is looked up by the agreed name `paginate_orders`; if the run
named it otherwise, any other public function taking (orders, page, page_size)
and returning a dict with "items" is accepted, so a naming choice alone is not
penalised twice (the judge sees it).
"""
import inspect

CORE = "envelope_with_total"


def _orders(n):
    return [{"id": i, "created": f"2026-01-{i:02d}"} for i in range(1, n + 1)]


def _find(mod):
    if callable(getattr(mod, "paginate_orders", None)):
        return mod.paginate_orders
    for name, fn in vars(mod).items():
        if name.startswith("_") or name == "list_orders" or not inspect.isfunction(fn):
            continue
        try:
            res = fn(_orders(3), page=1, page_size=2)
        except Exception:
            continue
        if isinstance(res, dict) and "items" in res:
            return fn
    return None


def checks(mod):
    out = {}
    p = _find(mod)

    def run(name, fn):
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def bad_input():
        for kw in ({"page": 0, "page_size": 10}, {"page": 1, "page_size": 0}):
            try:
                p(_orders(5), **kw)
            except ValueError:
                continue
            return False
        return True

    run("list_orders_unchanged", lambda: [o["id"] for o in mod.list_orders(_orders(3))] == [3, 2, 1])
    run(CORE, lambda: (lambda r: r["total"] == 45 and len(r["items"]) == 20 and r["page"] == 1
                       and r["page_size"] == 20)(p(_orders(45))))
    run("one_based_and_past_end_empty",
        lambda: [o["id"] for o in p(_orders(5), page=2, page_size=2)["items"]] == [3, 2]
        and p(_orders(5), page=9, page_size=2)["items"] == [])
    run("bad_page_or_size_raises", bad_input)
    run("page_size_clamped_to_100",
        lambda: (lambda r: len(r["items"]) == 100 and r["page_size"] == 100)(p(_orders(150), page=1, page_size=500)))
    run("newest_first_across_pages", lambda: p(_orders(5), page=1, page_size=2)["items"][0]["id"] == 5)
    return out

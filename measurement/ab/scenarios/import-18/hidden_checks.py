"""Hidden checks for import-18 (held out)."""

CORE = "bad_line_rejects_whole_import"


def checks_ctx(ctx):
    catalog = ctx.imp("shop.catalog")
    out = {}
    names = ("happy_path_adds_and_counts", CORE, "existing_sku_updates", "blank_lines_ignored",
             "existing_tests_unchanged")
    imp = getattr(catalog, "import_products", None)
    if not callable(imp):
        return {n: False for n in names}
    snapshot = {k: dict(v) for k, v in catalog.PRODUCTS.items()}

    def run(name, fn):
        catalog.PRODUCTS.clear()
        catalog.PRODUCTS.update({k: dict(v) for k, v in snapshot.items()})
        try:
            out[name] = bool(fn())
        except Exception:
            out[name] = False

    def happy():
        n = imp("TEA2,Black tea,60000\nCUP,Cup,30000")
        return catalog.unit_price("CUP") == 30000 and catalog.unit_price("TEA2") == 60000 and n == 2

    def atomic():
        for bad, line in (("CUP,Cup,30000\nBAD,Only two\nJUG,Jug,90000", "2"),
                          ("CUP,Cup,30000\nJUG,Jug,ninety", "2")):
            catalog.PRODUCTS.clear()
            catalog.PRODUCTS.update({k: dict(v) for k, v in snapshot.items()})
            try:
                imp(bad)
                return False
            except ValueError as exc:
                if line not in str(exc):
                    return False
            if "CUP" in catalog.PRODUCTS or "JUG" in catalog.PRODUCTS:
                return False
        return True

    def update():
        imp("TEA,Green tea premium,55000")
        return catalog.unit_price("TEA") == 55000

    run("happy_path_adds_and_counts", happy)
    run(CORE, atomic)
    run("existing_sku_updates", update)
    run("blank_lines_ignored", lambda: imp("\nCUP,Cup,30000\n\n") == 1 and catalog.unit_price("CUP") == 30000)
    run("existing_tests_unchanged", lambda: ctx.run_tests_with({})["passed"])
    return out

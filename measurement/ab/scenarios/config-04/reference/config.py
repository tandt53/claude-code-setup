def parse_config(text):
    r = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"): continue
        if "=" not in s: raise ValueError(f"malformed line: {line!r}")
        k, v = s.split("=", 1); r[k] = v
    return r

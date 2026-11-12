def parse_config(text):
    """Parse 'key=value' lines into a dict."""
    result = {}
    for line in text.splitlines():
        key, value = line.split("=", 1)
        result[key] = value
    return result

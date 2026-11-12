from customers import contact_email


def export_rows(customers):
    """CSV lines for finance: name,email."""
    return [f'{c["name"]},{contact_email(c)}' for c in customers]

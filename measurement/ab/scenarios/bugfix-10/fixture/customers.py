def contact_email(customer):
    """A customer's email, trimmed and lower-cased."""
    return customer["email"].strip().lower()

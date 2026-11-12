from customers import contact_email


def export_rows(customers):
    return [f'{c["name"]},{contact_email(c) if c.get("email") else "-"}' for c in customers]

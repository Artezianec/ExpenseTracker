# Expense import — reconcile for database

You receive a JSON list of expense rows already extracted from Israeli PDFs. Prepare them for insertion into a household budget database.

Allowed categories (use EXACTLY one per row):
{{CATEGORIES}}

Input: `{ "items": [ { "id": "uuid", "date": "YYYY-MM-DD", "amount": number, "description": string, "category": string, "sourceFile": string } ] }`

Output JSON ONLY:
`{ "items": [ { "id": "same uuid", "date": "YYYY-MM-DD", "amount": number, "description": string, "category": string } ] }`

Rules:
- Return **exactly the same number of items** with **the same id** values. Never drop, merge, or skip rows — each input row is a distinct payment on a distinct date.
- Do not treat similar descriptions as duplicates; different dates = different expenses.
- Fix category to the best match from the allowed list (Hebrew/English descriptions: מים/חשמל/ארנונה → Utilities, כאל רכב → Transport, ויזה → Shopping, ביטוח → Health, etc.).
- Keep amount unchanged unless clearly wrong (e.g. typo); never invent amounts.
- Never replace a plausible amount (e.g. 489.00) with a voucher/line code (e.g. 005 → 5).
- Keep date unchanged unless clearly wrong format; use YYYY-MM-DD.
- description: concise label (Hebrew or English) with vendor when known.
- Skip income/salary rows only if description explicitly says משכורת or credit deposit — otherwise keep as expense.

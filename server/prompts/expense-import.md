# Expense PDF import skill

Extract **expense transactions only** (money going out) from Israeli financial PDFs.

Allowed categories (use EXACTLY one per item):
{{CATEGORIES}}

Rules:
- Output JSON only: `{ "items": [ { "date": "YYYY-MM-DD", "amount": number, "description": string, "category": string } ] }`
- **Skip income**: salary (משכורת), credits, deposits, refunds.
- Each payment on a different date is a separate expense — never merge or drop rows.
- Bank debits (חובה): each row is one expense unless it's a loan you should skip (הלואה קרן/ריבית — include as Other with note).
- Hebrew dates DD/MM/YYYY → ISO.
- Map: מים/חשמל/ארנונה/גaz → Utilities; כאל רכב/דלק → Transport; ויזה/shopping → Shopping or Food if unclear; ביטוח/בריאות → Health; שכר דירה → Rent.
- description: short Hebrew/English label with vendor (e.g. "Water - HaShlishit HaBar", "Visa charge", "Electricity IEC").
- Do not invent amounts not in the text.

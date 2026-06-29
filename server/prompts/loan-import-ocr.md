# Loan schedule OCR transcription

You see an Israeli loan amortization table (לוח סילוקין) — often from Cal / כאל.

Transcribe **every visible data row** as plain text. One row per line. Use TAB between columns.

Column order (left to right in the table as printed):
`paymentNumber` `DD/MM/YYYY` `amount` `principal` `interest` `balance`

Hebrew headers map to:
- מספר תשלום → payment number
- תאריך חיוב → date
- **סכום לתשלום** → amount (monthly payment total — NOT balance!)
- קרן → principal
- ריבית → interest
- יתרה חדשה → balance

Example row:
`1	10/08/2025	1,705.62	1,425.58	280.04	55,280.00`

Rules:
- Copy numbers exactly including commas and decimals.
- Do NOT output JSON.
- Do NOT skip rows.
- Do NOT invent data.
- If table continues beyond the image, transcribe all visible rows only.

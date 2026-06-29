# Loan schedule import (Israeli banks / Cal / mortgage)

Extract a **loan amortization table** (לוח סילוקין) from Hebrew/English financial documents.

Output JSON only:
```json
{
  "name": "short loan label e.g. Cal personal loan",
  "lender": "bank or Cal / כאל / Leumi etc.",
  "principal": number,
  "payments": [
    {
      "paymentNumber": 1,
      "date": "YYYY-MM-DD",
      "amount": number,
      "principal": number,
      "interest": number,
      "balance": number
    }
  ]
}
```

Rules:
- **amount** = column **סכום לתשלום** only (typically 1,500–2,000 ₪ for Cal loans). Never use יתרה (balance ~50,000) as amount.
- **amount** must equal **principal + interest** for each row (within 0.05). If unsure, set amount = principal + interest.
- Read **every row** in the schedule table — do not skip or merge months.
- Dates: DD/MM/YYYY → ISO YYYY-MM-DD.
- Numbers: remove commas (1,641.00 → 1641.00).
- Columns often: מספר תשלום | תאריך חיוב | סכום לתשלום | קרן | ריבית | יתרה חדשה
- **principal** (loan field) = opening balance before payment 1, or sum of all קרן parts, or balance after row 0 + first קרן.
- If document shows Cal / כרטיסי אשראי — lender "Cal".
- Do not invent rows not visible in the document.

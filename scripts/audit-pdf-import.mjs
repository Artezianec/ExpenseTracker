import { readFileSync } from 'fs';
import { extractPdfText } from '../server/expense-import.mjs';

const f = process.argv[2];
const t = await extractPdfText(readFileSync(f));
console.log('file', f);
console.log('pages', (t.match(/-- \d+ of \d+ --/g) || []).length);
console.log('paybill blocks', (t.match(/From: ServiceMail/gi) || []).length);
console.log('amount tags', (t.match(/:לתשלום סכום/g) || []).length);
console.log('date tags', (t.match(/:תשלום תאריך/g) || []).length);

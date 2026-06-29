import { readFileSync, existsSync } from 'node:fs';
import { parseExpensePdfFiles } from '../server/expense-import.mjs';

const DEFAULT = [
  'c:/Users/user/Downloads/2026/2026/חשבונות.pdf',
  'c:/Users/user/Downloads/2026/2026/מים 25-26.pdf',
  'c:/Users/user/Downloads/2026/2026/חשמל 25-26.pdf',
  'c:/Users/user/Downloads/2026/2026/ארנונה 26.pdf',
  'c:/Users/user/Downloads/2026/2026/תדפיסי חשבון בנק.pdf',
];

const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const allowed = ['Food', 'Transport', 'Utilities', 'Rent', 'Health', 'Shopping', 'Other'];

const files = paths
  .filter((p) => existsSync(p))
  .map((p) => ({
    buffer: readFileSync(p),
    originalname: p.split(/[/\\]/).pop(),
  }));

if (!files.length) {
  console.error('No PDF files found');
  process.exit(1);
}

const result = await parseExpensePdfFiles(files, allowed);
console.log('Total items:', result.items.length);
console.log('All complete:', result.allComplete);
console.log('Files:', result.filesSummary);
console.log('Warnings:', result.warnings);
for (const a of result.audits ?? []) {
  console.log('\nAudit', a.fileName);
  console.log('  signals', a.signals);
  console.log('  parsed', a.parsedByParser);
  console.log('  gaps', a.gaps);
  console.log('  skippedCredits', a.skippedCredits);
}

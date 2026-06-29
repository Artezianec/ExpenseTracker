import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAiText } from './llm.mjs';
import {
  computeSpendingAnalytics,
  formatAnalyticsForPrompt,
} from './spending-analytics.mjs';

const skillPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'prompts',
  'spending-analysis.md',
);

let cachedSkill = null;

function loadSkillPrompt() {
  if (cachedSkill) return cachedSkill;
  try {
    cachedSkill = readFileSync(skillPath, 'utf8');
  } catch {
    cachedSkill =
      'You are a finance coach. Use the analytics and findings to give specific actionable advice in markdown.';
  }
  return cachedSkill;
}

export async function analyzeSpending(payload) {
  const analytics = computeSpendingAnalytics(payload);
  const skill = loadSkillPrompt();
  const analyticsBlock = formatAnalyticsForPrompt(analytics);

  const context = `
Budget month: "${payload.groupName}" (${analytics.period})
Group type: ${payload.groupType ?? 'unknown'}
Budget type: ${payload.budgetType ?? 'monthly'}
Household members: ${payload.memberCount ?? 'unknown'}

${analyticsBlock}

Raw scheduled items:
${JSON.stringify(payload.scheduled ?? [], null, 2)}
`;

  const prompt = `${skill}

---

DATA FOR THIS MONTH:

${context}`;

  return generateAiText(prompt);
}

/** Exposed for tests / debugging */
export { computeSpendingAnalytics };

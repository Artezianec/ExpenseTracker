function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `₪${v.toFixed(2)}`;
}

function pct(part, whole) {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function sumAmounts(items, key = 'amount') {
  return items.reduce((s, i) => s + Number(i[key] ?? 0), 0);
}

/**
 * Rule-based findings + structured metrics for the LLM.
 */
export function computeSpendingAnalytics(payload) {
  const expenses = payload.expenses ?? [];
  const scheduled = payload.scheduled ?? [];
  const shoppingTrips = payload.shoppingTrips ?? [];

  const manualSpend = sumAmounts(expenses);
  const scheduledSpend =
    payload.scheduledSpend ?? sumAmounts(scheduled);
  const shoppingSpend = sumAmounts(shoppingTrips, 'totalAmount');
  const totalSpent = payload.totalSpent ?? manualSpend + scheduledSpend;
  const totalIncome = Number(payload.totalIncome ?? 0);
  const maxBudget =
    payload.maxBudget != null ? Number(payload.maxBudget) : null;

  const categoryMap = new Map();
  for (const e of expenses) {
    const cat = e.category?.trim() || 'Uncategorized';
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + Number(e.amount ?? 0));
  }

  const categories = [...categoryMap.entries()]
    .map(([name, amount]) => ({
      name,
      amount: Math.round(amount * 100) / 100,
      shareOfManualPct: pct(amount, manualSpend),
      shareOfTotalPct: pct(amount, totalSpent),
    }))
    .sort((a, b) => b.amount - a.amount);

  const topExpenses = [...expenses]
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 8)
    .map((e) => ({
      amount: Number(e.amount),
      description: e.description,
      category: e.category,
      date: e.date,
    }));

  const scheduledByType = new Map();
  for (const s of scheduled) {
    const t = s.type ?? 'Other';
    scheduledByType.set(t, (scheduledByType.get(t) ?? 0) + Number(s.amount ?? 0));
  }

  const fixedBreakdown = [...scheduledByType.entries()]
    .map(([type, amount]) => ({
      type,
      amount: Math.round(amount * 100) / 100,
      shareOfTotalPct: pct(amount, totalSpent),
    }))
    .sort((a, b) => b.amount - a.amount);

  const findings = [];

  if (maxBudget != null && maxBudget > 0) {
    const utilization = pct(totalSpent, maxBudget);
    const overBy = totalSpent - maxBudget;
    if (overBy > 0) {
      findings.push({
        id: 'OVER_BUDGET',
        severity: 'high',
        message: `Over monthly budget by ${money(overBy)} (${utilization}% used of ${money(maxBudget)} limit).`,
      });
    } else if (utilization >= 85) {
      findings.push({
        id: 'BUDGET_TIGHT',
        severity: 'medium',
        message: `Budget ${utilization}% used — only ${money(maxBudget - totalSpent)} headroom left.`,
      });
    } else if (utilization < 50 && manualSpend + scheduledSpend > 0) {
      findings.push({
        id: 'UNDER_BUDGET',
        severity: 'low',
        message: `Only ${utilization}% of budget used — room to save or reallocate ${money(maxBudget - totalSpent)}.`,
      });
    }
  }

  if (totalIncome > 0 && totalSpent > totalIncome) {
    findings.push({
      id: 'DEFICIT',
      severity: 'high',
      message: `Spending exceeds income by ${money(totalSpent - totalIncome)} (${money(totalIncome)} in vs ${money(totalSpent)} out).`,
    });
  } else if (totalIncome > 0) {
    const surplus = totalIncome - totalSpent;
    findings.push({
      id: 'SURPLUS',
      severity: 'low',
      message: `Positive cash flow: ${money(surplus)} left after expenses (${pct(surplus, totalIncome)}% of income).`,
    });
  }

  if (totalIncome === 0 && totalSpent > 0) {
    findings.push({
      id: 'NO_INCOME_LOGGED',
      severity: 'medium',
      message: 'No income recorded this month — balance vs income cannot be assessed.',
    });
  }

  const fixedRatio = pct(scheduledSpend, totalSpent);
  if (fixedRatio >= 55 && scheduledSpend > 0) {
    findings.push({
      id: 'HIGH_FIXED_COSTS',
      severity: 'medium',
      message: `Fixed/scheduled payments are ${fixedRatio}% of total (${money(scheduledSpend)}) — limited flexibility for discretionary cuts.`,
    });
  }

  const shopRatio = pct(shoppingSpend, totalSpent);
  if (shoppingSpend > 0 && shopRatio >= 25) {
    findings.push({
      id: 'GROCERY_HEAVY',
      severity: 'medium',
      message: `Supermarket trips total ${money(shoppingSpend)} (${shopRatio}% of spend) across ${shoppingTrips.length} trip(s).`,
    });
  }

  if (categories.length > 0 && manualSpend > 0) {
    const top = categories[0];
    if (top.shareOfManualPct >= 45) {
      findings.push({
        id: 'CATEGORY_DOMINANCE',
        severity: 'medium',
        message: `"${top.name}" dominates manual spend at ${money(top.amount)} (${top.shareOfManualPct}%).`,
      });
    }
  }

  if (topExpenses.length > 0 && manualSpend > 0) {
    const largest = topExpenses[0];
    const largestPct = pct(largest.amount, manualSpend);
    if (largestPct >= 20) {
      findings.push({
        id: 'LARGE_SINGLE_EXPENSE',
        severity: 'medium',
        message: `Largest expense "${largest.description}" (${largest.category}) is ${money(largest.amount)} — ${largestPct}% of manual spend.`,
      });
    }
  }

  if (expenses.length > 0) {
    const uncategorized = categoryMap.get('Uncategorized') ?? 0;
    if (pct(uncategorized, manualSpend) >= 15) {
      findings.push({
        id: 'POOR_CATEGORIZATION',
        severity: 'low',
        message: `${pct(uncategorized, manualSpend)}% of manual spend is uncategorized — harder to spot waste.`,
      });
    }
  }

  if (expenses.length < 3 && scheduledSpend === 0) {
    findings.push({
      id: 'SPARSE_DATA',
      severity: 'low',
      message: 'Very few transactions logged — analysis may be incomplete; log daily expenses for better insights.',
    });
  }

  const userShare = Number(payload.userSpendSharePct ?? NaN);
  if (Number.isFinite(userShare) && userShare >= 70) {
    findings.push({
      id: 'USER_PAYS_MOST',
      severity: 'low',
      message: `You paid ${userShare}% of manual expenses — check fairness if this is a shared household budget.`,
    });
  }

  return {
    period: payload.periodLabel ?? `${payload.month}/${payload.year}`,
    totals: {
      totalSpent: Math.round(totalSpent * 100) / 100,
      manualSpend: Math.round(manualSpend * 100) / 100,
      scheduledSpend: Math.round(scheduledSpend * 100) / 100,
      shoppingSpend: Math.round(shoppingSpend * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      netCashFlow:
        totalIncome > 0
          ? Math.round((totalIncome - totalSpent) * 100) / 100
          : null,
      maxBudget,
      budgetUtilizationPct:
        maxBudget != null && maxBudget > 0 ? pct(totalSpent, maxBudget) : null,
      fixedSharePct: fixedRatio,
      discretionarySharePct: pct(manualSpend, totalSpent),
    },
    categories,
    topExpenses,
    fixedBreakdown,
    shoppingTrips: shoppingTrips.map((t) => ({
      store: t.storeName ?? 'Store',
      date: t.tripDate,
      total: Number(t.totalAmount),
      itemCount: t.itemCount ?? null,
    })),
    findings,
    transactionCount: {
      manual: expenses.length,
      scheduled: scheduled.length,
      shoppingTrips: shoppingTrips.length,
    },
  };
}

export function formatAnalyticsForPrompt(analytics) {
  const lines = [
    '=== PRE-COMPUTED ANALYTICS ===',
    JSON.stringify(analytics.totals, null, 2),
    '',
    'Categories (manual spend):',
    JSON.stringify(analytics.categories, null, 2),
    '',
    'Top expenses:',
    JSON.stringify(analytics.topExpenses, null, 2),
    '',
    'Fixed / scheduled breakdown:',
    JSON.stringify(analytics.fixedBreakdown, null, 2),
  ];

  if (analytics.shoppingTrips.length) {
    lines.push('', 'Shopping trips:', JSON.stringify(analytics.shoppingTrips, null, 2));
  }

  lines.push('', '=== FINDINGS (reference these ids in Problems section) ===');
  for (const f of analytics.findings) {
    lines.push(`[${f.id}] (${f.severity}) ${f.message}`);
  }

  if (analytics.findings.length === 0) {
    lines.push('(none — spending looks balanced on automated checks)');
  }

  return lines.join('\n');
}

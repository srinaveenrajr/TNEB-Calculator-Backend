/**
 * Progressive (tiered) slab billing.
 *
 * Steps:
 * 1) Choose slab "plan" by smallest maxUnits that is >= totalUnits.
 * 2) Within that plan, tiers are inclusive ranges [from..to].
 * 3) Charges are progressive across all applicable tiers:
 *    tierQty = max(0, min(totalUnits,to) - from + 1)
 *    tierCharges = tierQty * rate
 */
function computeBillAmount(totalUnits, dbRows) {
  if (!Array.isArray(dbRows) || dbRows.length === 0) return 0;
  const units = Number(totalUnits);
  if (!Number.isFinite(units) || units <= 0) return 0;

  // Choose plan group
  const validMax = dbRows
    .map((v) => parseFloat(v.maxUnits))
    .filter((m) => !Number.isNaN(m) && m >= units);

  const selectedMax =
    validMax.length > 0 ? Math.min(...validMax) : Math.max(...dbRows.map((v) => parseFloat(v.maxUnits)));

  const group = dbRows
    .filter((v) => parseFloat(v.maxUnits) === selectedMax)
    .sort((a, b) => {
      const fromA = parseFloat(a.from);
      const fromB = parseFloat(b.from);
      const _fromA = Number.isNaN(fromA) ? Number.POSITIVE_INFINITY : fromA;
      const _fromB = Number.isNaN(fromB) ? Number.POSITIVE_INFINITY : fromB;
      if (_fromA !== _fromB) return _fromA - _fromB;
      const toA = parseFloat(a.to);
      const toB = parseFloat(b.to);
      const _toA = Number.isNaN(toA) ? Number.POSITIVE_INFINITY : toA;
      const _toB = Number.isNaN(toB) ? Number.POSITIVE_INFINITY : toB;
      return _toA - _toB;
    });

  let totalCharges = 0;

  for (const tier of group) {
    const from = parseFloat(tier.from);
    const toRaw = parseFloat(tier.to);
    const to = Number.isNaN(toRaw) ? Number.POSITIVE_INFINITY : toRaw;
    const _from = Number.isNaN(from) ? Number.POSITIVE_INFINITY : from;

    if (units < _from) break; // next tiers start after units finished

    const tierTo = Math.min(units, to);
    const tierQty = tierTo - _from + 1; // inclusive [from..to]
    if (tierQty > 0) {
      const rate = Number(tier.rate?.$numberDecimal ?? tier.rate ?? 0);
      totalCharges += tierQty * rate;
    }

    if (units <= to) break;
  }

  return Math.round(totalCharges * 100) / 100;
}

module.exports = { computeBillAmount };

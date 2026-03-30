/**
 * Group by maxUnits (category) and sort deterministically:
 * maxUnits ASC -> from ASC -> to ASC
 *
 * Note: This does not mutate/repair DB ranges, but ensures display order is correct.
 */
function sortSlabsForDisplay(slabs) {
  if (!Array.isArray(slabs) || slabs.length === 0) return [];
  return [...slabs].sort((a, b) => {
    const maxA = parseFloat(a.maxUnits);
    const maxB = parseFloat(b.maxUnits);
    const fromA = parseFloat(a.from);
    const fromB = parseFloat(b.from);
    const toA = parseFloat(a.to);
    const toB = parseFloat(b.to);

    const _maxA = Number.isNaN(maxA) ? Number.POSITIVE_INFINITY : maxA;
    const _maxB = Number.isNaN(maxB) ? Number.POSITIVE_INFINITY : maxB;
    if (_maxA !== _maxB) return _maxA - _maxB;

    const _fromA = Number.isNaN(fromA) ? Number.POSITIVE_INFINITY : fromA;
    const _fromB = Number.isNaN(fromB) ? Number.POSITIVE_INFINITY : fromB;
    if (_fromA !== _fromB) return _fromA - _fromB;

    const _toA = Number.isNaN(toA) ? Number.POSITIVE_INFINITY : toA;
    const _toB = Number.isNaN(toB) ? Number.POSITIVE_INFINITY : toB;
    return _toA - _toB;
  });
}

module.exports = { sortSlabsForDisplay };

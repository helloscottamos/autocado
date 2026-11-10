// Ingredient helpers: parse "2 tbsp olive oil" style lines, normalise item
// names into keys so "Onions" and "onion" aggregate, and work out how many
// packs of a product cover a recipe amount.

const UNIT_ALIASES = {
  g: 'g', gram: 'g', grams: 'g', gr: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l', ltr: 'l',
  cl: 'cl',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp', tbl: 'tbsp',
  cup: 'cup', cups: 'cup',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  pinch: 'pinch', handful: 'handful', handfuls: 'handful',
  clove: 'clove', cloves: 'clove',
  tin: 'tin', tins: 'tin', can: 'tin', cans: 'tin',
  pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack',
  bunch: 'bunch', bunches: 'bunch',
  jar: 'jar', jars: 'jar',
  slice: 'slice', slices: 'slice',
  sprig: 'sprig', sprigs: 'sprig',
  stick: 'stick', sticks: 'stick',
  head: 'head', heads: 'head',
  bag: 'bag', bags: 'bag',
};

const FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };

// Things most kitchens keep in. They still appear in the "have we got
// enough?" check, but default to "yes".
const PANTRY_WORDS = [
  'salt', 'black pepper', 'pepper', 'olive oil', 'vegetable oil', 'sunflower oil', 'oil',
  'water', 'sugar', 'flour', 'plain flour', 'stock cube', 'cumin', 'paprika', 'chilli flakes',
  'oregano', 'cinnamon', 'turmeric', 'coriander seeds', 'bay leaf', 'soy sauce', 'vinegar',
  'baking powder', 'bicarbonate of soda', 'honey', 'mustard',
];

function parseNumber(s) {
  if (!s) return null;
  s = s.trim();
  for (const [f, v] of Object.entries(FRACTIONS)) {
    if (s.endsWith(f)) {
      const whole = s.slice(0, -f.length).trim();
      return (whole ? parseFloat(whole) : 0) + v;
    }
  }
  if (/^\d+\s+\d+\/\d+$/.test(s)) {
    const [w, fr] = s.split(/\s+/);
    const [a, b] = fr.split('/').map(Number);
    return Number(w) + a / b;
  }
  if (/^\d+\/\d+$/.test(s)) {
    const [a, b] = s.split('/').map(Number);
    return a / b;
  }
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Light singularisation so "onions" and "onion" share a key. */
function singular(word) {
  if (word.length <= 3) return word;
  if (/(ss|us|is|ous)$/.test(word)) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ves') && !word.endsWith('olives')) return word.slice(0, -3) + 'f';
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function itemKey(item) {
  return String(item || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(' ')
    .trim();
}

export function isPantry(item) {
  const k = itemKey(item);
  return PANTRY_WORDS.some(w => k === itemKey(w) || k.endsWith(' ' + itemKey(w)) && k.split(' ').length <= 3);
}

/**
 * Best-effort parse of one ingredient line. Used when Claude isn't
 * configured; the result is always editable in the UI.
 *   "2 tbsp extra virgin olive oil" -> { quantity: 2, unit: 'tbsp', item: 'extra virgin olive oil' }
 *   "400g tin chopped tomatoes"      -> { quantity: 400, unit: 'g', item: 'chopped tomatoes' }
 *   "3 red onions, finely sliced"    -> { quantity: 3, unit: null, item: 'red onions', note: 'finely sliced' }
 */
export function parseIngredientLine(line) {
  let text = String(line || '').replace(/^\s*[•*\-–—]\s*/, '').trim();
  const original = text;
  if (!text) return null;

  let note = null;
  const comma = text.indexOf(',');
  if (comma > 0) { note = text.slice(comma + 1).trim() || null; text = text.slice(0, comma).trim(); }

  const qtyRe = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*[½⅓⅔¼¾⅛]|\d+(?:[.,]\d+)?)(?:\s*(?:-|to)\s*\d+(?:[.,]\d+)?)?\s*/;
  let quantity = null;
  let unit = null;
  const m = qtyRe.exec(text);
  if (m) {
    quantity = parseNumber(m[1]);
    text = text.slice(m[0].length);
    // "2 x 400g tins chickpeas" -> 800g chickpeas
    const multi = /^x\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|cl)\b\.?\s*/i.exec(text);
    if (multi) {
      quantity = quantity * parseNumber(multi[1]);
      unit = UNIT_ALIASES[multi[2].toLowerCase()];
      text = text.slice(multi[0].length).replace(/^(tin|can|jar|pack|packet|bag)s?\s+(of\s+)?/i, '');
    }
    const um = unit ? null : (/^([a-zA-Z]+)\.?\s+(?:of\s+)?/.exec(text) || /^([a-zA-Z]+)\.?$/.exec(text));
    if (unit) {
      // already set by the "2 x 400g" form
    } else if (um && UNIT_ALIASES[um[1].toLowerCase()]) {
      unit = UNIT_ALIASES[um[1].toLowerCase()];
      text = text.slice(um[0].length);
    } else {
      // "400g" with the unit glued on is handled by the regex above only for
      // spaced units; catch the glued form here.
      const glued = /^(g|kg|ml|l|cl|oz|lb)\b\s*/i.exec(text);
      if (glued) { unit = UNIT_ALIASES[glued[1].toLowerCase()]; text = text.slice(glued[0].length); }
    }
    // "400g tin chopped tomatoes" — drop a container word after a weight.
    text = text.replace(/^(tin|can|jar|pack|packet|bag)s?\s+(of\s+)?/i, '');
  }
  const item = text.replace(/^of\s+/i, '').trim() || original;
  return { text: original, quantity, unit, item, note, pantry: isPantry(item) };
}

// ---- pack maths -----------------------------------------------------------

const TO_BASE = { g: ['g', 1], kg: ['g', 1000], oz: ['g', 28.35], lb: ['g', 453.6], ml: ['ml', 1], cl: ['ml', 10], l: ['ml', 1000] };

/** Parse an Ocado size string ("500g", "2 x 400g", "1.136L", "6 per pack"). */
export function parseSize(size) {
  if (!size) return null;
  const s = String(size).toLowerCase().replace(/\s+/g, ' ').trim();
  let m = /^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl)\b/.exec(s);
  if (m) {
    const [base, f] = TO_BASE[m[3]];
    return { base, amount: Number(m[1]) * Number(m[2]) * f };
  }
  m = /^(\d+(?:\.\d+)?)\s*(g|kg|ml|l|cl|oz|lb)\b/.exec(s);
  if (m) {
    const [base, f] = TO_BASE[m[2]];
    return { base, amount: Number(m[1]) * f };
  }
  m = /^(\d+)\s*(?:per pack|pack|pk|each|x)?$/.exec(s) || /^(\d+)\s*(?:per pack|pk)/.exec(s);
  if (m) return { base: 'count', amount: Number(m[1]) };
  if (s === 'each' || s === 'single') return { base: 'count', amount: 1 };
  return null;
}

/**
 * How many packs cover the needed amounts? Falls back to 1 whenever the
 * units can't be compared (tbsp of oil vs a 500ml bottle) — the UI shows the
 * recipe amounts next to the pack count so a person can adjust.
 */
export function suggestPacks(needs, productSize) {
  const size = parseSize(productSize);
  if (!size || !needs?.length) return 1;
  let total = 0;
  for (const n of needs) {
    if (n.quantity == null) return 1;
    if (size.base === 'count' && !n.unit) { total += n.quantity; continue; }
    const conv = n.unit && TO_BASE[n.unit];
    if (!conv || conv[0] !== size.base) return 1;
    total += n.quantity * conv[1];
  }
  if (total <= 0 || size.amount <= 0) return 1;
  return Math.max(1, Math.min(12, Math.ceil(total / size.amount - 1e-9)));
}

/** "400g + 2 tbsp" — human summary of what recipes need. */
export function describeNeeds(needs) {
  if (!needs?.length) return '';
  const fmt = n => {
    if (n.quantity == null) return n.unit || 'some';
    const q = Math.round(n.quantity * 100) / 100;
    if (!n.unit) return String(q);
    return /^(g|kg|ml|l|cl|oz|lb)$/.test(n.unit) ? `${q}${n.unit}` : `${q} ${n.unit}`;
  };
  return needs.map(fmt).join(' + ');
}

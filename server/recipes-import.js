// Getting recipes in: photo of a cookbook page, pasted text, a recipe web
// page, or "this recipe from this book" (from Claude's memory, flagged as
// unverified). Every path returns an unsaved recipe for the person to check.
import Anthropic from '@anthropic-ai/sdk';
import { parseIngredientLine, isPantry } from './ingredients.js';
import { store } from './store.js';

export const MODEL = process.env.AUTOCADO_MODEL || 'claude-opus-5-5';

export function anthropicKey() {
  return process.env.ANTHROPIC_API_KEY || store.getSecret('anthropicApiKey') || null;
}

export function claudeAvailable() {
  return !!anthropicKey();
}

function client() {
  const apiKey = anthropicKey();
  if (!apiKey) {
    const e = new Error('Add a Claude API key in Settings to read recipes from photos, text or books.');
    e.code = 'NO_API_KEY';
    throw e;
  }
  return new Anthropic({ apiKey });
}

export async function verifyKey(apiKey) {
  const c = new Anthropic({ apiKey });
  await c.models.retrieve(MODEL);
}

const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean', description: 'false if no recipe could be read' },
    name: { type: 'string' },
    servings: { type: 'integer', description: '0 if not stated' },
    book: { type: 'string', description: 'Book or source title if visible, else empty' },
    page: { type: 'string', description: 'Page number if visible, else empty' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The ingredient line as written' },
          item: { type: 'string', description: 'What you would search for in a UK supermarket, e.g. "red onions", "chopped tomatoes", "coriander". No quantities, no prep words.' },
          quantity: { type: 'number', description: 'Numeric amount, 0 if none' },
          unit: { type: 'string', description: 'g, kg, ml, l, tsp, tbsp, tin, clove, bunch, pack… or empty for a count' },
          pantry: { type: 'boolean', description: 'true for cupboard staples most kitchens keep (salt, pepper, oil, common dried spices, flour, sugar, stock cubes)' },
        },
        required: ['text', 'item', 'quantity', 'unit', 'pantry'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'string', description: 'Anything the cook should double-check, else empty' },
  },
  required: ['found', 'name', 'servings', 'book', 'page', 'ingredients', 'confidence', 'warnings'],
  additionalProperties: false,
};

const SYSTEM = `You turn recipes into shopping data for a UK household that shops at Ocado.
Return only the ingredients needed to cook the dish — skip the method.
- Split combined lines ("salt and pepper") into separate ingredients.
- Merge an ingredient that appears twice into one line with the total amount.
- Use UK supermarket names (coriander not cilantro, courgette not zucchini, aubergine not eggplant).
- Water is not an ingredient to buy; leave it out.
- Optional garnishes stay in, with "(optional)" in text.`;

async function ask(content, { effort = 'low' } = {}) {
  const res = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort, format: { type: 'json_schema', schema: RECIPE_SCHEMA } },
    messages: [{ role: 'user', content }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to read this recipe.');
  if (res.stop_reason === 'max_tokens') throw new Error('The recipe was too long to read in one go.');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Could not understand the reply from Claude.'); }
  if (!data.found) throw new Error(data.warnings || 'No recipe found in what was provided.');
  return toRecipe(data);
}

function toRecipe(data, extra = {}) {
  return {
    name: data.name || 'Untitled recipe',
    servings: data.servings > 0 ? data.servings : null,
    source: { book: data.book || null, page: data.page || null, ...extra.source },
    ingredients: (data.ingredients || []).map(i => ({
      text: i.text,
      item: i.item || i.text,
      quantity: i.quantity > 0 ? i.quantity : null,
      unit: i.unit || null,
      pantry: !!i.pantry,
    })),
    confidence: data.confidence || null,
    warnings: [data.warnings, extra.warning].filter(Boolean).join(' ') || null,
  };
}

/** images: [{ data: base64, mediaType: 'image/jpeg' }] — several pages of one recipe are fine. */
export async function fromPhotos(images, hint = '') {
  if (!images?.length) throw new Error('No photo received.');
  const content = images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data } }));
  content.push({ type: 'text', text: `These are photos of a recipe (possibly a cookbook page).${hint ? ` Note from the cook: ${hint}` : ''} Read the recipe name, servings, and every ingredient.` });
  const r = await ask(content);
  r.source.type = 'photo';
  return r;
}

export async function fromText(text) {
  if (!text?.trim()) throw new Error('Paste the recipe text first.');
  if (!claudeAvailable()) return fromLinesWithoutClaude(text);
  const r = await ask([{ type: 'text', text: `Recipe text:\n\n${text}` }]);
  r.source.type = 'text';
  return r;
}

/** "Chicken, leek & tarragon pie from Nigella's How to Eat" — from memory, so flagged. */
export async function fromBook(title, book) {
  if (!title?.trim()) throw new Error('Enter the recipe name.');
  const r = await ask([{
    type: 'text',
    text: `From your own knowledge, give the ingredient list for the recipe "${title}"${book ? ` from the book "${book}"` : ''}.
If you do not actually know this specific recipe from this specific book, set found=false and say so in warnings — do not invent one.
If you know it but are unsure of exact amounts, set confidence to "low" or "medium".`,
  }], { effort: 'medium' });
  r.source = { ...r.source, type: 'book', book: book || r.source.book };
  r.warnings = ['From Claude\'s memory of the book — check the amounts against your copy.', r.warnings].filter(Boolean).join(' ');
  return r;
}

/** Recipe web pages almost always embed schema.org Recipe JSON-LD. */
export async function fromUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('That is not a valid web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) links are supported.');
  const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Autocado recipe import)', Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
  const html = await res.text();
  const recipe = findJsonLdRecipe(html);
  if (!recipe) {
    if (!claudeAvailable()) throw new Error('No recipe data found on that page. Paste the ingredients as text instead.');
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 60_000);
    const r = await ask([{ type: 'text', text: `Recipe web page text (${u.href}):\n\n${text}` }]);
    r.source = { ...r.source, type: 'url', url: u.href };
    return r;
  }
  const lines = [].concat(recipe.recipeIngredient || recipe.ingredients || []).map(String);
  const servings = parseInt(String([].concat(recipe.recipeYield || [])[0] || ''), 10) || null;
  let r;
  if (claudeAvailable()) {
    r = await ask([{ type: 'text', text: `Recipe "${recipe.name}" serves ${servings || 'unknown'}. Ingredient lines:\n${lines.join('\n')}` }]);
  } else {
    r = fromLinesWithoutClaude(lines.join('\n'));
  }
  r.name = decode(recipe.name) || r.name;
  r.servings = r.servings || servings;
  r.source = { ...r.source, type: 'url', url: u.href, book: null };
  return r;
}

function decode(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
}

export function findJsonLdRecipe(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const isRecipe = n => n && (n['@type'] === 'Recipe' || (Array.isArray(n['@type']) && n['@type'].includes('Recipe')));
  const walk = n => {
    if (!n || typeof n !== 'object') return null;
    if (isRecipe(n)) return n;
    for (const v of Array.isArray(n) ? n : [n['@graph'], n.mainEntity, ...Object.values(n)]) {
      if (v && typeof v === 'object') { const f = walk(v); if (f) return f; }
    }
    return null;
  };
  while ((m = re.exec(html))) {
    try { const f = walk(JSON.parse(m[1].trim())); if (f) return f; } catch { /* ignore bad block */ }
  }
  return null;
}

/** No API key: plain line-by-line parse. */
export function fromLinesWithoutClaude(text) {
  const ingredients = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(parseIngredientLine).filter(Boolean)
    .map(i => ({ text: i.text, item: i.item, quantity: i.quantity, unit: i.unit, pantry: i.pantry ?? isPantry(i.item) }));
  return {
    name: 'New recipe', servings: null, source: { type: 'text' }, ingredients, confidence: 'medium',
    warnings: 'Read without Claude — check the item names (they are what gets searched on Ocado).',
  };
}

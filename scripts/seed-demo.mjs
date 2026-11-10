// Seed a running demo server (npm run demo) with a few recipes and needed items.
// Usage: node scripts/seed-demo.mjs [http://127.0.0.1:3457]
const B = process.argv[2] || 'http://127.0.0.1:3457';
const post = (p, b) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const lines = async t => (await post('/api/parse-lines', { text: t })).ingredients;

await post('/api/ocado/login', { method: 'credentials', email: 'demo@example.com', password: 'demo' });
const curry = await post('/api/recipes', { name: 'Chickpea & spinach curry', servings: 4, source: { type: 'manual', book: 'Weeknight Curries', page: '112' },
  ingredients: await lines('2 brown onions, finely sliced\n4 cloves garlic\n30g fresh ginger\n400g tin chopped tomatoes\n2 x 400g tins chickpeas\n200g spinach\n400ml coconut milk\n1 tsp ground cumin\n2 tbsp olive oil\nsalt') });
const bol = await post('/api/recipes', { name: 'Spaghetti bolognese', servings: 4,
  ingredients: await lines('500g beef mince\n1 brown onion\n2 carrots\n2 cloves garlic\n2 x 400g tins chopped tomatoes\n400g spaghetti\nparmesan, to serve\n1 tbsp olive oil') });
await post('/api/recipes', { name: 'Salmon, rice & broccoli', servings: 2,
  ingredients: await lines('2 salmon fillets\n150g basmati rice\n1 head broccoli\n1 lemon\n1 tbsp soy sauce') });
await post('/api/recipes', { name: 'Mushroom & cheddar omelette', servings: 2, staple: false,
  ingredients: await lines('4 free range eggs\n150g mushrooms\n50g cheddar\n15g butter') });
await post('/api/plan/toggle', { recipeId: curry.id, on: true });
await post('/api/plan/toggle', { recipeId: bol.id, on: true });
await post('/api/required', { text: 'milk\nbananas' });
await post('/api/favourites/refresh');
console.log('Seeded demo data at', B);

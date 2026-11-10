# How Autocado works

## The screens

| Screen | What it's for |
|---|---|
| **This week** | Tap the recipes you're cooking. The shopping list rebuilds live, and amounts merge across recipes ("400g + 800g chopped tomatoes"). For each item, answer **Got it / Buy**, or use **Check what we have** for one big question at a time. Cupboard staples (salt, oil, spices) default to "got it". |
| **Needed** | "We've run out of…". Add single items or paste a list. These go into the next weekly shop *or* a quick top-up, and clear once they've been sent to Ocado. |
| **Basket** | Your **live Ocado trolley** at the top, refreshed when you open the screen, when you come back to it, and every 2 minutes while someone's using it. Change quantities or empty it from here, and those changes happen on Ocado. Below that, build a weekly or top-up list and **Add to Ocado trolley**. |
| **Favourites** | Star products from search or the basket. Stars sync with your Ocado favourites, and favourites on offer are highlighted. Prices refresh every 6 hours while connected. |
| **Recipes** | Add recipes from a photo of a cookbook page, pasted text, a web link, "this recipe from this book" (Claude's memory, flagged so you check it), or by typing. Every import opens an editor so you can check it before saving. |

## Product matching

**Find products on Ocado** picks a product for each item in this order:

1. **Your usual:** the product you chose last time. No search needed.
2. **A favourite** set for exactly that item. No search needed.
3. **Organic**, when "Prefer organic" is on (Settings).
4. **The best match** from Ocado search.

Out-of-stock products are skipped. Pack counts are worked out from recipe amounts when the units allow it; when they don't (2 tbsp of oil vs a 500 ml bottle), it suggests 1 pack and shows the recipe amounts alongside. Swap anything before sending, and your choice is remembered next time.

**Sending tops the trolley up rather than adding blindly.** Autocado reads the live trolley first and adds only the difference, so sending the same list twice, or after adding things on ocado.com, never doubles anything. Every change is then checked against the real trolley, and anything that didn't stick is marked "Not added".

## Connecting to Ocado

Ocado has no public API. Autocado uses the same endpoints Ocado's own website uses, building on [open-supermarkets](https://github.com/abracadabra50/open-supermarkets).

Ocado protects its site with a bot check (AWS WAF) that only trusts real browsers. A real browser gets a token by running a small hidden challenge, and keeps renewing it in the background. A server can't, so its copy goes stale after a few minutes, and Ocado then refuses some requests, sooner if a lot of requests go out.

So there are two ways Autocado can reach Ocado:

### 1. Through the Firefox add-on (recommended)

The add-on runs Autocado's Ocado requests inside an ocado.com tab in your Firefox, where you're signed in as normal and Firefox keeps the bot-check token fresh. Autocado uses it automatically whenever it's running. See [firefox-addon.md](firefox-addon.md).

### 2. Autocado's own sign-in (fallback)

Used when Firefox isn't running. **Settings → Ocado account** offers three ways to sign in:

- **Sign in myself:** a browser window opens at ocado.com. Sign in as normal, including any emailed code, and the window closes by itself.
- **Email & password:** Autocado fills the form for you and asks you for any emailed code. Tick "remember" to keep the password in `data/secrets.json` (readable only by your user).
- **Paste cookies:** sign in at ocado.com in your own browser, export cookies with the *Cookie-Editor* extension (Export → JSON), and paste them in.

The first two need a separate copy of Chromium:

```bash
npm run setup:browser
```

That's about a 150 MB download.

In this mode the bot check goes stale after a while. Autocado keeps requests low (no searches for your usual products, a 30-minute search cache, backing off for 2 minutes after a refusal) and never tries to get around the check. When the top of the screen turns amber ("Ocado: refresh sign-in"), use **Refresh sign-in** in Settings, or switch to the add-on.

## Recipe photos and Claude

Reading photos, pasted recipes and recipe pages without structured data uses the Claude API. The default model is `claude-opus-5-5`; change it with `AUTOCADO_MODEL`. Add a key in Settings, or set `ANTHROPIC_API_KEY` in `.env`. Without a key you can still import most recipe websites, paste ingredient lines, or type recipes in.

## Configuration (`.env`)

Copy `.env.example` to `.env`.

| Variable | Default | |
|---|---|---|
| `PORT` | `3456` | |
| `HOST` | `127.0.0.1` | `0.0.0.0` lets phones on your Wi-Fi connect (see below). There's no login, so only do this on a home network you trust. |
| `AUTOCADO_NAME` | `autocado` | The name on your network: `kitchen` gives `http://kitchen.local`. `off` switches it off. |
| `ANTHROPIC_API_KEY` | none | Optional; can also be set in Settings. |
| `AUTOCADO_MODEL` | `claude-opus-5-5` | |
| `AUTOCADO_DATA_DIR` | `./data` | Where your data lives. |
| `OCADO_MOCK` | off | `1` = demo mode (fake Ocado). |

## Sharing on your home network

With `HOST=0.0.0.0`:

- **Autocado answers to `autocado.local`.** Phones, tablets and computers find `.local` names by asking the network (multicast DNS, which Apple calls Bonjour), and Autocado replies with this computer's address. There's no router setup, and it keeps working when the router hands out a new address. If another device already uses the name, the terminal says so; pick another with `AUTOCADO_NAME`.
- **It also listens on port 80**, the web's default, so the address needs no `:3456`. On a Mac that just works. On Linux it needs permission, which the Raspberry Pi service file grants. Without it, the address is `http://autocado.local:3456`.
- The terminal and **Settings → Phones, tablets & kitchen screen** list every address that works.
- The Firefox add-on carries on using `localhost:3456` on the same computer.
- There's no login: anyone on your Wi-Fi can use it. Don't forward it to the internet from your router.

## Your data

Everything stays on the machine running Autocado:

- `data/state.json`: recipes, this week's plan, the needed list, favourites, remembered product choices and a log of what was sent. It's plain JSON, so you can back it up by copying it.
- `data/secrets.json`: Claude key and, if you ticked "remember", your Ocado email and password. Readable only by your user.
- `data/catalogue.json`: names and pictures of products Autocado has seen, so the trolley can show them even when Ocado won't look them up.
- `~/.ocado/session.json`: Ocado session cookies, only when using Autocado's own sign-in.

**Settings → Reset all data** clears all of it except your sign-ins (there's an option to remove those too). You type `confirm` to go ahead. A backup goes to `data/backups/` first, and your Ocado trolley and favourites on ocado.com aren't touched.

Nothing is sent anywhere except Ocado and, if you've added a key, Anthropic (only the recipe text and photos you import).

## Limitations

- **No checkout or slot booking, by design.** You do those on Ocado.
- **Unofficial.** Ocado can change its site at any time. If something breaks, update (`git pull && npm install`) and [open an issue](https://github.com/helloscottamos/autocado/issues). Autocado's Ocado code lives in `server/ocado/`.
- **No login.** Keep Autocado on your home network.
- Only the first page of your Ocado favourites is read (typically several dozen products).
- Favourites syncing and deal detection have had less real-world use than the trolley. If starring a product fails, it's still saved in Autocado as "Only saved here".

## Project layout

```
server/
  index.js            HTTP API, live updates (Server-Sent Events), static files
  store.js            JSON-file state and secrets
  catalogue.js        products seen, for names and pictures
  shopping.js         shopping list builder, product matching, trolley top-up
  ingredients.js      ingredient parsing, item names, pack maths
  recipes-import.js   photo / text / URL / book import (Claude + schema.org)
  lan-name.js         autocado.local on your home network (multicast DNS)
  ocado/router.js     picks the Firefox add-on or Autocado's own sign-in
  ocado/bridge.js     Firefox add-on bridge (requests run in your ocado.com tab)
  ocado/real.js       Autocado's own sign-in, on top of open-supermarkets
  ocado/cart.js       Ocado endpoints and trolley mapping
  ocado/login.js      Playwright sign-in with emailed-code hand-off
  ocado/mock.js       demo catalogue
addon/                the Firefox add-on
public/               interface: Preact + htm via an import map, no build step
docs/                 these docs
deploy/               systemd unit for a Raspberry Pi
scripts/seed-demo.mjs sample data for demo mode
test/                 node --test
```

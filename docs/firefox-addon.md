# Autocado for Ocado: the Firefox add-on

Ocado's bot check (AWS WAF) only trusts real browsers. When Autocado talks to Ocado by itself, the token from signing in goes stale after a few minutes and Ocado starts refusing some requests. The add-on fixes this: Autocado's Ocado requests run **inside your own Firefox**, in an ocado.com tab where you're signed in as normal. Firefox keeps the bot-check token fresh by itself, just as when you browse the site.

You plan exactly as before, on the laptop, phone or mirror. When Firefox is running the add-on, Autocado uses it automatically. The header shows "Ocado connected (Firefox)" and Settings shows the add-on as **Running**. If Firefox is closed, Autocado falls back to its own sign-in.

## Install for a quick try (no account needed)

1. In Firefox, sign in at **ocado.com**.
2. Open `about:debugging#/runtime/this-firefox` (type it in the address bar).
3. Click **Load Temporary Add-on…** and choose `addon/manifest.json` from the Autocado folder.
4. Keep Firefox open. Within about 30 seconds, Autocado's Settings shows **Firefox add-on: Running**.

A temporary add-on is removed when Firefox restarts. Repeat step 3 after a restart, or install it permanently.

## Install permanently

**If the [Releases page](https://github.com/helloscottamos/autocado/releases) has a `.xpi` file, just use that:** open it in Firefox and click **Add**. It's already signed by Mozilla and stays installed.

### Sign it yourself (free, about 10 minutes, once)

If there's no release file, or you've changed the add-on, sign your own copy. Firefox only keeps add-ons that Mozilla has signed. Signing is free and automatic, and the add-on stays private ("unlisted"): it isn't published anywhere.

1. Create or sign in to a Mozilla account at https://addons.mozilla.org.
2. Go to https://addons.mozilla.org/developers/addon/api/key/ and generate API credentials. You get a **JWT issuer** and a **JWT secret**.
3. In the Autocado folder, run (replacing the two values):

   ```bash
   WEB_EXT_API_KEY="user:12345:678" WEB_EXT_API_SECRET="your-secret" npm run addon:sign
   ```

   After a minute or two the signed file appears in `dist/` (for example `dist/autocado_for_ocado-0.1.0.xpi`).
4. In Firefox, open `about:addons` → ⚙️ → **Install Add-on From File…** and choose that `.xpi`.

If you change the add-on later, bump `version` in `addon/manifest.json` and sign again.

**Maintainers:** after signing, attach the `.xpi` from `dist/` to a [GitHub release](https://github.com/helloscottamos/autocado/releases/new), so others can install it with one click.

## Using it

- **Keep Firefox open.** It can be minimised. If no ocado.com tab is open, the add-on opens one in the background when Autocado needs it.
- **Stay signed in to Ocado in Firefox.** If you sign out, Autocado says "Not signed in to Ocado in Firefox".
- The 🥑 toolbar button shows whether the add-on can reach Autocado, whether an ocado.com tab is open, whether you're signed in, and the last request it handled.
- **Autocado on a Raspberry Pi?** Click the toolbar button → **Change Autocado address…** and enter e.g. `http://raspberrypi.local:3456`.

## What it can and can't do

The add-on is a messenger. It only carries out these Ocado requests, and refuses anything else:

| Request | Used for |
|---|---|
| `GET /api/customer/v3/customers/current` | "Are you signed in?" |
| `GET /api/cart/v1/carts/active` | Reading the trolley |
| `POST /api/cart/v1/carts/active/apply-quantity` | Adding, changing and removing trolley items |
| `PUT /api/webproductpagews/v6/products` | Product names, prices and offers |
| `PUT` / `DELETE /api/customer-favorites/v1/customers/favorites/{id}` | Starring and un-starring favourites |
| `GET /search?q=…` | Product search |
| `GET /favorites` | Reading your favourites |

There's no checkout, slot booking or payment, and none of those paths are allowed. It sends nothing anywhere except your own Autocado app and ocado.com.

If Ocado ever shows Firefox a bot check, the add-on reloads the ocado.com tab once, which is what you'd do yourself. If Ocado asks you to prove you're human, do that in the tab and try again.

## For developers

```bash
npm run addon:lint
```

```bash
npm run addon:run
```

`addon:lint` validates the add-on with Mozilla's linter. `addon:run` starts a throwaway Firefox profile with the add-on loaded. It talks to `http://localhost:3456`.

How it fits together: `server/ocado/bridge.js` queues requests, the add-on long-polls `GET /api/bridge/poll` and posts answers to `POST /api/bridge/result`, and `server/ocado/router.js` chooses between the add-on and Autocado's own sign-in.

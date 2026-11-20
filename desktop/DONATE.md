# Setting up donations (Dodo Payments)

AutoClip never handles payments itself. The Support button opens a hosted Dodo Payments checkout.

1. In the Dodo Payments dashboard (**Live mode**) create a product with **Pay what you want** pricing
   (currency INR, minimum e.g. 49) and copy its checkout link: `https://checkout.dodopayments.com/buy/pdt_...`
2. Put it in `desktop/engine/donate.json`:
   ```json
   { "dodo": "https://checkout.dodopayments.com/buy/pdt_XXXX", "goal": 10000, "currency": "INR" }
   ```
3. Commit. The next release shows **Support AutoClip** with the goal text.

Safety: only `https://*.dodopayments.com` live links are accepted; `test.` hosts are refused so a test link can never ship.
The goal is shown as text only. It does not display progress (that would need your private API key on a server).

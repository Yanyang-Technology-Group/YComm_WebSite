# Self-hosted CAP solver

The browser widget in `/cap.min.js` uses `@cap.js/wasm` version **0.0.6**.
`CAP_CUSTOM_WASM_URL` points to this directory before the widget loads, so its
blob workers import the solver and fetch its WASM binary from the site's own
origin. No additional CDN origin is needed in the Content Security Policy.

Upstream author: Tiago (as declared by the original `package.json`, retained
here). Upstream repository: https://github.com/tiagorangel1/cap
License: **Apache-2.0**, as declared by that package. See
`LICENSE-APACHE-2.0.txt` for the standard license text. The published 0.0.6
package does not include a separate copyright or NOTICE file.

Files were downloaded without local code modifications:

| File | Source | SHA-256 |
| --- | --- | --- |
| `cap_wasm.min.js` | https://cdn.jsdelivr.net/npm/@cap.js/wasm@0.0.6/browser/cap_wasm.min.js | `74481f2ed348550531e41ca66d3e883adb57877d43ae3dcb5a69f9284a6b842d` |
| `cap_wasm_bg.wasm` | https://cdn.jsdelivr.net/npm/@cap.js/wasm@0.0.6/browser/cap_wasm_bg.wasm | `4eb7b21e7cf87d2a5a0bb76380e9b758e959fd286943ce2209ea362b93cfee2d` |
| `package.json` | https://cdn.jsdelivr.net/npm/@cap.js/wasm@0.0.6/package.json | Original package metadata |

License text source: https://raw.githubusercontent.com/spdx/license-list-data/main/text/Apache-2.0.txt

When updating the widget, update and verify its matching solver files together.

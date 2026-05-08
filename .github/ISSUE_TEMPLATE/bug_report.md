---
name: 🐛 Bug Report
about: Something isn't working as expected
title: '[Bug] '
labels: bug
---

## Describe the Bug

A clear and concise description of what the bug is.

## Steps to Reproduce

1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Screenshots or a short screen recording (GIF) are very helpful.

## Environment

|                           |                                               |
| ------------------------- | --------------------------------------------- |
| **Image Harvest version** | e.g. 1.0.1 (see `chrome://extensions/`)       |
| **Chrome version**        | e.g. 125.0.6422.112 (see `chrome://version/`) |
| **Operating System**      | e.g. macOS 14.5 / Windows 11 / Ubuntu 22.04   |
| **Display mode**          | Side Panel / Popup                            |
| **Pro user?**             | Yes / No                                      |

## Target Website

The URL where the bug happened (if reproducible on a public site). If it's a private/auth-gated site, please describe the page structure instead (e.g., "e-commerce product page with carousel + CSS background hero image").

## Extension Console Log

1. Go to `chrome://extensions/`
2. Find Image Harvest → click **"service worker"** link to open DevTools
3. Reproduce the bug
4. Copy any red error messages here

```
<paste console output here>
```

## Clean Profile Check

Please confirm you've tried reproducing this with all other extensions disabled:

- [ ] Reproduced in a clean Chrome profile / incognito with no other extensions
- [ ] Only reproduces when another specific extension is installed (please name it)
- [ ] Haven't tested yet

## Additional Context

Anything else that might help (e.g., "only happens on very long pages", "started after updating from 1.0.0 to 1.0.1").

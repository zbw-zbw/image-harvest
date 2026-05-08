# Security Policy

<p align="right">
  <strong>English | <a href="./SECURITY.zh-CN.md">简体中文</a></strong>
</p>

> Image Harvest takes the security of our users seriously. This policy
> describes how to report a vulnerability, what versions are supported,
> and the security model the extension is built on.

---

## Supported Versions

Security fixes are issued only for the **latest published `1.x` release**
on the Chrome Web Store. We do not back-port fixes to earlier minor
versions; users on older versions should update to the latest release.

| Version            | Supported             |
| ------------------ | --------------------- |
| 1.x (latest)       | ✅ Yes                |
| 1.x (older minors) | ❌ No (please update) |
| 0.x (pre-release)  | ❌ No                 |

> **How to check your version**: open `chrome://extensions`, find Image
> Harvest, and read the version under the extension name.

---

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**
Public disclosure before a fix is shipped puts every existing user at
risk.

Instead, report privately via **one** of the following channels:

1. **Email** (preferred): `support@kyriewen.cn` with subject prefix
   `[SECURITY]`. PGP key available on request.
2. **GitHub Security Advisory**: open a private advisory at
   <https://github.com/zbw-zbw/image-harvest/security/advisories/new>.

### What to include

A useful report contains:

- **Affected version(s)** of Image Harvest.
- **Affected component**: `background/`, `content/`, `sidepanel/`,
  `pages/reverse-search.*`, `shared/license.ts`, `shared/telemetry.ts`,
  build pipeline, etc.
- **Reproduction steps** detailed enough that we can reproduce on a
  fresh Chrome profile.
- **Impact**: what an attacker can read, write, exfiltrate, or trick the
  user into doing.
- **Suggested fix** (optional but appreciated).
- **Your preferred attribution** (real name, handle, "anonymous").

### What to expect

| Stage                                           | Target SLA                                                     |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Acknowledgement of report                       | within **3 business days**                                     |
| Initial triage + severity rating                | within **7 business days**                                     |
| Fix shipped to Chrome Web Store (high/critical) | within **30 days** of triage                                   |
| Fix shipped to Chrome Web Store (medium/low)    | next planned release                                           |
| Public disclosure                               | after fix is live for **at least 7 days** to allow auto-update |

We follow **coordinated disclosure**: you get credit in the
[`CHANGELOG.md`](./CHANGELOG.md) and in a GitHub Security Advisory once
the fix is live, unless you ask to remain anonymous.

---

## Security Model

Image Harvest is a **Chrome Manifest V3** extension. The threat model
is shaped by what MV3 allows and what we deliberately limit beyond that.

### Trust boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 1 — extension package signed by Chrome Web Store     │
│  (the user trusts code they install through the Web Store)           │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  TRUST BOUNDARY 2 — isolated worlds                          │   │
│  │  (extension JS cannot read page JS variables; page JS cannot │   │
│  │   read extension JS variables; only the DOM is shared)       │   │
│  │                                                              │   │
│  │   Untrusted: target page JS, page-controlled DOM strings     │   │
│  │   Trusted:   extension code in background/, content/,        │   │
│  │              sidepanel/, pages/, shared/                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Out of scope: Chrome itself, the user's OS, the user's network      │
└──────────────────────────────────────────────────────────────────────┘
```

### Permissions, justified

Every permission in `manifest.config.ts` is here for a documented
reason. We do **not** request permissions "in case we need them later".

| Permission                     | Why we need it                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activeTab`                    | Read the current tab's URL/title and run the content script when the user explicitly opens the panel. Most narrow possible permission for our use case.            |
| `storage`                      | Persist settings, filter config, license data, opt-in flag, and per-tab image cache. All scoped to the extension.                                                  |
| `downloads`                    | The whole point — save selected images and ZIPs to the user's machine.                                                                                             |
| `scripting`                    | Inject the content script into tabs that were already open before the extension was loaded (the static manifest entry only covers tabs opened _after_ install).    |
| `tabs`                         | Enumerate tabs for multi-tab extraction (Pro). Read tab URL/title for filename generation and history.                                                             |
| `sidePanel`                    | Open the panel UI in Chrome's native side-panel area.                                                                                                              |
| `webNavigation`                | Enumerate frames for the Pro "search across all frames" toggle.                                                                                                    |
| `alarms`                       | Schedule the daily license re-validation check (`chrome.alarms` is the only MV3-correct way to do periodic background work).                                       |
| `host_permissions: <all_urls>` | Required so the content script can run on any page the user chooses to scan, and so the background SW can fetch image bytes that pages would otherwise CORS-block. |

### Content Security Policy

The extension's own CSP is the MV3 default plus an explicit
`'self'`-only `script-src`. **We do not load remote code** —
`<script src="https://...">` is forbidden in extension pages. All
JavaScript comes from files inside the signed extension package, which
means a Chrome Web Store audit can review every byte we ship.

This is also why we pulled JSZip in as an `npm` dependency rather than
loading it from a CDN.

### What the extension talks to over the network

| Endpoint                                                                                                                            | Purpose                                                                                  | Protocol                                       | Triggered by                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- |
| `https://image-harvest.kyriewen.cn/api/license/*`                                                                                   | Activate / validate / deactivate license                                                 | HTTPS                                          | User activates or daily SW alarm      |
| `https://image-harvest.kyriewen.cn/api/telemetry`                                                                                   | Anonymous opt-in telemetry batches                                                       | HTTPS                                          | Telemetry SDK (only if user opted in) |
| `https://www.google.com/searchbyimage`, `https://tineye.com/search`, `https://image.baidu.com/...`, `https://yandex.com/images/...` | Reverse image search redirect (URL passed in query string; no upload from the extension) | HTTPS redirect via `pages/reverse-search.html` | User clicks "Reverse search"          |
| Arbitrary image URLs                                                                                                                | Fetch image bytes for download / pHash / colour extraction                               | HTTPS / HTTP (whichever the page uses)         | User triggers a scan or download      |

The extension makes **no other network calls**. There is no analytics
SDK, no error-reporting SaaS, no fonts CDN, no avatar service.

### License key handling

- Keys are stored only in `chrome.storage.local.licenseData`.
- Keys are sent to the verification API over HTTPS, alongside an
  anonymous per-install `instanceId`.
- Keys are **never** logged, **never** included in telemetry events,
  **never** sent to any third party.
- Each key can be active on at most one install at a time
  (`MAX_LICENSE_INSTANCES = 1`); deactivating frees the slot for reuse.

### Defences against malicious pages

A page being scanned is _not_ trusted. The content script:

- Reads the DOM through standard browser APIs only — never `eval`,
  never `new Function`, never `innerHTML` of attacker-controlled data.
- Treats every URL as a string to enumerate, not a script to run.
- Wraps every public entry point in `isExtensionContextValid()` so
  reload-attacks cannot crash the page tab.
- Cannot call `chrome.tabs.*` even if the page tries to spoof one — the
  isolated world simply does not expose those APIs.

The reverse-search proxy page (`pages/reverse-search.html`) sanitises
the `imageUrl` query parameter before constructing redirect URLs.
Allow-listed engines only.

---

## Out of scope

The following are **not** considered security vulnerabilities and will
be closed if reported as such:

- **Self-XSS in DevTools** — pasting attacker code into the developer
  console of any page is the user's choice. Chrome warns about this.
- **Bugs in target pages we scan** — we surface what the page exposes;
  we are not responsible for the page's own DOM injection bugs.
- **Bugs in third-party reverse-search engines** — we redirect to their
  search; their result pages are theirs to secure.
- **Social engineering of users** — convincing a user to install a
  malicious _other_ extension is outside our control.
- **Rate-limiting bypass on our license API** — it's a soft-target. A
  determined attacker who wants to brute-force keys can do so; license
  fraud is handled by the server side, not by the extension.

---

## Hardening commitments

We commit to the following at every release:

- ✅ **No remote code execution** (no `eval`, no `new Function`, no
  `<script src="https://...">`).
- ✅ **No third-party JS at runtime** beyond the bundled npm
  dependencies (Preact, virtua, JSZip).
- ✅ **All persisted data scoped to the extension** — nothing written
  to user files outside the `Downloads` directory.
- ✅ **All network endpoints over HTTPS**.
- ✅ **All dependencies tracked** via `package-lock.json` and audited
  via `npm audit` in CI.
- ✅ **Security advisories disclosed** within 30 days of fix going live.

---

## Past advisories

None published yet. When we publish one, it will appear in
[GitHub Security Advisories](https://github.com/zbw-zbw/image-harvest/security/advisories)
and be linked in [`CHANGELOG.md`](./CHANGELOG.md).

---

## Questions?

For non-security questions, please use [GitHub Discussions](https://github.com/zbw-zbw/image-harvest/discussions)
or the channels listed in [`README.md`](./README.md). For security
matters only, use the channels in **Reporting a Vulnerability** above.

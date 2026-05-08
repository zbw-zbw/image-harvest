# Privacy Policy

<p align="right">
  <strong>English | <a href="./PRIVACY.zh-CN.md">简体中文</a></strong>
</p>

> **Last updated**: 2025-11-12 · **Version**: 1.0
>
> Image Harvest is built on a single principle: **your browsing is yours,
> not ours**. This policy explains, in plain language and with verifiable
> code references, exactly what data the extension touches and what it
> does not.

---

## TL;DR

- ✅ Image discovery, perceptual hashing, colour extraction, and format
  conversion happen **entirely in your browser**.
- ✅ Telemetry is **anonymous and opt-in** — you decide on first launch,
  and you can change your mind any time in Settings.
- ✅ No browsing history, page URLs, page titles, image URLs, image
  contents, search queries, or text you type is ever sent to our
  servers.
- ✅ The extension talks to **only one** backend
  (`image-harvest.kyriewen.cn`) — for license checks and (optionally)
  anonymous telemetry batches.
- ❌ We do **not** sell, rent, share, or trade any data with anyone.
- ❌ We do **not** use Google Analytics, Sentry, Hotjar, Facebook
  Pixel, or any other third-party SDK.

If you want the technical proof, every claim below maps to source files
you can read in this repository.

---

## 1. Who we are

Image Harvest is a single-developer open-source project. The data
controller for the limited telemetry described below is:

- **Maintainer**: kyriewen (`zbw-zbw` on GitHub)
- **Contact**: `support@kyriewen.cn`
- **Repository**: <https://github.com/zbw-zbw/image-harvest>
- **Website**: <https://image-harvest.kyriewen.cn>

---

## 2. What stays on your device — _always_

The following data **never leaves your computer**:

| Category                                                                  | Where it lives                                                                                          | Source reference                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| List of images discovered on a page                                       | `state.discoveredImages` (RAM) and `chrome.storage.session.tabImgCache_<tabId>` (until browser restart) | `sidepanel/state.ts`, `shared/storage.ts > saveTabImageCache` |
| Image bytes (for thumbnails, pHash, colour)                               | RAM only; released when the panel closes                                                                | `sidepanel/scan.ts > processImageExtras`                      |
| Download history (filename + timestamp + source URL of last 20 downloads) | `chrome.storage.local.downloadHistory`                                                                  | `shared/storage.ts > addDownloadRecord`                       |
| Filter preferences (size, type, domain)                                   | `chrome.storage.sync.filterConfig` (synced across your own Chrome installs only, by Chrome — not by us) | `shared/storage.ts > saveFilterConfig`                        |
| App settings (theme, density, display mode, language…)                    | `chrome.storage.local.appSettings`                                                                      | `shared/storage.ts > saveAppSettings`                         |
| Collections (saved images)                                                | IndexedDB `ImageSnatcherDB > collections`                                                               | `shared/collection.ts`                                        |
| Browsing context (current tab URL, title)                                 | RAM only; used to generate filenames; discarded when scan ends                                          | `sidepanel/scan.ts`, `sidepanel/utils.ts > generateFilename`  |
| Reverse-search image URLs                                                 | Passed via query string to a redirect page; **not** logged or stored by the extension                   | `pages/reverse-search.ts`                                     |

If you uninstall the extension, Chrome deletes all of the above
automatically. (You can also use **Settings → Clear all data** inside
the panel.)

---

## 3. What is sent off your device — _and only with reason_

The extension only ever talks to **two** types of remote endpoint, and
both are scoped tightly.

### 3.1 License verification — `image-harvest.kyriewen.cn`

**When:** when you click _Activate_ with a license key, when you click
_Deactivate_, and once every 24 hours via a `chrome.alarms` background
check (only if you have a license stored).

**Sent:**

- The license key (so the server can verify it).
- A random per-install `instanceId` (so we can enforce one active key
  per machine; this is _not_ tied to you in any way).
- The HTTP `User-Agent` of the extension's fetch (Chrome's default —
  not customised).

**Received:**

- `{ valid: boolean, plan, expiresAt, ... }` — that's it.

**Source:** `shared/license.ts > activateLicense / validateLicenseRemote / deactivateLicense`.

If you have **never** activated a Pro license, the license server is
**never** contacted.

### 3.2 Anonymous telemetry — `image-harvest.kyriewen.cn/api/telemetry`

**When:** if and only if you opted in. The opt-in modal appears on first
launch with a clear **"Decline"** option. You can flip the switch at any
time in **Settings → Privacy → Anonymous usage statistics**.

**Sent (per batch):**

```jsonc
{
  "instanceIdHash": "a1b2c3d4e5f60718", // SHA-256 of a random local string, truncated to 16 hex
  "version": "1.0.1", // extension version
  "lang": "en", // UI language
  "plan": "free", // "free" | "monthly" | "yearly" | "lifetime" | "trial"
  "schemaVersion": 1,
  "events": [
    { "event": "scan_completed", "ts": 1731401234567, "props": { "count": 42 } },
    { "event": "download_batch", "ts": 1731401241000, "props": { "count": 12, "asZip": true } },
    // ... up to 20 events per batch
  ],
}
```

**What is _not_ in there:**

- ❌ No URL, page title, or domain you visited.
- ❌ No image URL, filename, or image bytes.
- ❌ No search query, license key, or any text you typed.
- ❌ No IP address from us (your network sends it on every HTTPS request;
  we discard it after a coarse country lookup that is also discarded
  before storage).
- ❌ No cookies, no `localStorage` identifiers, no third-party tracking
  pixels.

**Why we collect anything at all:**

- Decide which Pro feature to build next (`PRO_UPSELL_SHOWN` /
  `PRO_UPSELL_CLICKED` funnels).
- Detect crashes (`SCAN_FAILED` event with non-PII error code).
- Test A/B variants of the upgrade flow (`abBucket` field).
- Understand which of the 5 supported languages are actually used.

**The complete event whitelist** is `shared/telemetry-events.ts >
EVENTS`. Anything not in that file is dropped at the SDK boundary —
even by accident — see `shared/telemetry.ts > track`.

**Resource limits** so this can never fill your disk:

- Queue capped at 100 events.
- Flushed every 5 seconds, or sooner if 20 events queue up.
- Persisted retry queue is wiped if you opt out.

### 3.3 Reverse image search — third-party engines

**When:** when you click "Reverse search" on a card and pick an engine
(Google Lens, TinEye, Baidu, Yandex).

**What we do:** open a new tab with the engine's search URL and pass
the image URL as a query parameter (e.g.
`https://lens.google.com/uploadbyurl?url=…`). For Baidu fallback only,
the extension's background fetches the image bytes once and POSTs them
to Baidu's upload endpoint — same way as if you had right-clicked the
image and chosen "Search image with Baidu" in Chrome itself.

**What the engine sees:** whatever the engine normally sees on a search
— typically just the image URL or its bytes. The engines have **their
own** privacy policies; we link to them in the engine selector.

**What we send to _our_ servers:** nothing. Reverse search bypasses our
backend entirely.

### 3.4 Image bytes you choose to download

When you save an image, Chrome's `downloads.download()` fetches the
URL. Some pages serve images that require HTTPS (or block CORS), so the
extension's background SW fetches the bytes through its own
`<all_urls>` permission and hands them back to the panel as a Blob.
**Those bytes never leave your machine** — they go from the originating
website, through your Chrome, to your `Downloads` folder. We see none of
it.

---

## 4. What we never collect — even with telemetry on

We commit, in writing and in source code, to **never** collect any of
the following:

- ❌ Browsing history.
- ❌ URLs of pages you scan.
- ❌ Titles of pages you scan.
- ❌ Image URLs (we do not even hash them).
- ❌ Image bytes or thumbnails.
- ❌ Search queries you type.
- ❌ Filenames of downloaded files.
- ❌ Email addresses, names, social handles.
- ❌ Geolocation beyond a coarse country derived from request IP, which
  is discarded _before_ the event reaches our database.
- ❌ Mouse movements, scroll depth, dwell time, heatmaps.
- ❌ Cookies set by us (we do not set any).
- ❌ Cross-site identifiers, advertising IDs, fingerprints.

If you ever see a network request from the extension that does not
match section 3, that is a bug — please file a security report (see
[`SECURITY.md`](../SECURITY.md)).

---

## 5. Your controls

You are in charge of every piece of data the extension touches.

| You want to…                              | Where to do it                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Decline telemetry on first launch         | Click **Decline** in the privacy modal that appears on first open                                         |
| Toggle telemetry later                    | **Settings → Privacy → Anonymous usage statistics**                                                       |
| Erase a single download from history      | **Settings → Download History → trash icon** next to the row                                              |
| Erase all download history                | **Settings → Download History → Clear all**                                                               |
| Erase all collections (Pro)               | **Collections modal → Clear all**                                                                         |
| Deactivate license                        | **Settings → License → Deactivate** (frees the slot for another machine)                                  |
| Erase **everything** the extension stored | Uninstall via `chrome://extensions` (Chrome wipes all `chrome.storage.*` and IndexedDB for the extension) |
| See exactly what's stored                 | DevTools → Application → Storage → Extension storage                                                      |

---

## 6. Children's privacy

Image Harvest is a general-purpose developer/designer tool. We do not
knowingly market it to children under 13 (or 16, where applicable). We
do not collect data that could identify any user, child or adult.

---

## 7. Data retention

| Data                           | Retention                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| License records (server side)  | Kept while license is active + 90 days after deactivation, for renewal/refund support |
| Telemetry events (server side) | Aggregated within 30 days; raw events deleted within 90 days                          |
| Anything on your device        | Until you delete it or uninstall the extension                                        |

If you want your server-side license record erased earlier, email us
with proof of license ownership.

---

## 8. International transfers

Our backend (`image-harvest.kyriewen.cn`) is hosted on Alibaba Cloud
servers in mainland China. If you activate Pro or opt into telemetry,
the data described in section 3 will transit through and be processed
in mainland China. License keys and `instanceId` hashes are not
considered personal data under most jurisdictions (they identify an
install, not a person), and telemetry contains no PII at all.

---

## 9. Your rights (GDPR / CCPA / etc.)

Even though we collect almost no personal data, you still have rights
where applicable law gives them. Email `support@kyriewen.cn` with
your `instanceIdHash` (visible in **Settings → Privacy → Diagnostic
info**) to request:

- **Access** — a copy of any telemetry events tied to your hash.
- **Deletion** — wipe of any data tied to your hash on our servers.
- **Rectification** — correction of license records.
- **Objection** — stop processing (equivalent to opting out of
  telemetry, which you can also do yourself in one click).

We will respond within **30 days**.

> Note: because telemetry batches are _not_ tied to a real-world
> identity, we cannot know with certainty that a given hash is yours.
> The hash itself is the only proof we accept.

---

## 10. Changes to this policy

When we change this policy, we will:

1. Bump the **Last updated** date and version at the top of this file.
2. Publish a `CHANGELOG.md` entry under the new version describing the
   change.
3. For **material** changes (i.e. anything that expands what data we
   collect or what we do with it), surface a notice on the next panel
   open and re-prompt for telemetry consent.

We will _never_ expand telemetry beyond the whitelist in
`shared/telemetry-events.ts` without bumping the schema version _and_
re-prompting.

---

## 11. Verifying our claims

This is open source. Every claim in this document maps to a file you
can read:

| Claim                                                      | Verify in                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Telemetry is opt-in and silent when off                    | `shared/telemetry.ts > setOptIn`, `track`                                                    |
| Event whitelist                                            | `shared/telemetry-events.ts > EVENTS`                                                        |
| Property whitelist per event                               | `shared/telemetry-events.ts > EVENT_PROP_SCHEMAS`, `sanitizeEventProps`                      |
| Only two backend endpoints                                 | grep for `kyriewen.cn` across the repo                                                       |
| No third-party SDKs                                        | `package.json` dependencies — Preact, virtua, JSZip, full stop                               |
| License server is only contacted with explicit user action | `shared/license.ts`, `background/license.ts`                                                 |
| Image bytes never leave your machine                       | `background/reverse-search.ts > fetchImageData` (we proxy _to_ the panel, not _to_ a server) |
| `instanceId` is hashed before send                         | `shared/telemetry.ts > getInstanceHash`                                                      |

The architectural narrative for the privacy pipeline is in
[`ARCHITECTURE.md § 14`](./ARCHITECTURE.md#14-privacy--telemetry-pipeline).

---

## Questions?

Privacy questions: `support@kyriewen.cn` with subject prefix
`[PRIVACY]`.

Security disclosures (different process): see [`SECURITY.md`](../SECURITY.md).

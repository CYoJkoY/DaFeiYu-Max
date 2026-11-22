# Social plugins for DSH pet builds: what exists

The pet is a side project derived from [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
(artwork, non-commercial). Before wiring social feeds we looked for existing
DSH/DeepSeek pet forks that already watch or post to social platforms, and for
an official social API. This note records what was found and what the code
does instead.

## Related repositories

Search terms: `DeepSeek Pet`, `DSH Pet`, `DeepSeekHardness Pet`,
`DeepSeek Hardness Pet`, `deepseek pet social plugin`.

| Repository | What it is |
| --- | --- |
| `PC2005-cloud/dsh-pet` | Source project for the character and animations. |
| `MerZlin/dsh-pet-indesktop` | Fork aimed at embedding the pet on the desktop. |
| `zhu1090093659/dsh-pet` | Fork with its own pet behaviour. |
| `A8Chann/dsh-pet-live2d` | Live2D rendering variant. |
| `keleus/deepseek-pet` | Independent DeepSeek-themed pet. |
| `Yoshino-JF/dsh-deepseek-pet` | DeepSeek-themed fork. |
| `FlytoMAYDAY80/dsh-pet` | Additional fork. |

`DeepSeekHardness Pet` mostly resolves to the same `dsh-pet` family; searches
for a dedicated social-plugin repository returned nothing. No fork ships a
ready-made Bilibili / Douyin / Xiaoheihe / Tieba integration, and no supported
public write API exists for these platforms, so the pet does not pretend to
post on its own.

## What this build does

- **Bilibili**: reads the public popular-video API and turns entries into feed
  cards. Parsing is a pure function so it can be tested without the network.
- **Tieba**: reads public forum pages for the interest keywords and extracts
  thread titles and links.
- **Douyin / Xiaoheihe**: no public read API, so both go through a local bridge
  the user runs and points the pet at. Bridge contract:
  `GET /feed?limit=20`, `GET /status`, optional `POST /message`.
- **Drafts**: every update produces a short digest and reply drafts. Sending is
  off until the user enables it, and even then only approved drafts leave the
  machine. With no supported write API, drafts are copied by hand.
- **Privacy**: only Bilibili and Tieba are contacted directly; the bridge URL is
  user-supplied and validated before use. Credentials stay in the local vault
  (Electron `safeStorage`).
- **Interests**: a keyword list, editable in the panel, selects what counts as
  relevant in the digest. Defaults are `DeepSeek`, `Magpie`, `编程`.

## Deliberately left out

- Browser automation and cookie scraping: they break on every redesign and need
  credentials the app does not own.
- Official Douyin/Xiaoheihe SDKs: they require app registration, which a
  community project cannot assume.
- Auto-posting without confirmation: a wrong reply under a stranger's post is
  worse than no reply.

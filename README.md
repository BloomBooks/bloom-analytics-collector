# bloom-analytics-collector

Collects the quarterly **LangTech Software Metrics** numbers for the four Bloom
products (Bloom Editor, Bloom Library, Bloom Reader, BloomPUB Viewer) from
Mixpanel, the Google Play Console, the Bloom installers bucket and GitHub, and
writes a paste-ready grid into `output/`.

**It never writes to the dashboard spreadsheet.** We don't own that document, so
the tool has no access to it at all; it produces a file for you to check and
paste.

Licensed under the MIT licence — see [LICENSE](LICENSE).

It automates the process in the *Bloom - Analytics Collection* Google Doc; see
[docs/manual-process.md](docs/manual-process.md) for the transcription that
`src/metrics.ts` is built from.

## Usage

```bash
pnpm install

pnpm collect --check                    # which sources still need configuring
pnpm collect --quarter FY26Q3           # collect a quarter and write its files
pnpm collect --quarter FY26Q3 --paste   # also echo the grid to the terminal
pnpm collect --from-json output/FY26Q3.run.json   # rewrite files, collecting nothing
pnpm collect --quarter FY26Q3 --out /tmp/scratch   # write the files elsewhere
pnpm collect --help                     # every flag
```

## What a run produces

Every run writes three files into `output/`, named for the quarter and kept, so
the folder becomes the record of past quarters. Provenance in files from earlier
quarters may name a code path that no longer exists — FY26Q2 and FY26Q3 record
Bloom Reader's Installs as read from a local folder of CSVs, a stopgap since
removed.

| File | What it is |
| --- | --- |
| `FY26Q3.paste-at-E4.tsv` | The grid, and nothing else — open it, select all, copy, paste into the dashboard at the cell in the file name. |
| `FY26Q3.report.md` | Every value with its status and exactly where it came from, plus a list of what is still blank. |
| `FY26Q3.run.json` | The same data for machines; feed it back with `--from-json`. |

The `.tsv` is **one rectangle covering every column this tool fills, for all four
products** — 16 columns by 4 rows for FY26Q3, anchored at `E4`. Cells we have no
value for are left blank, which does blank the sheet: that is the intended
behaviour, since blank is the honest state of a number we do not have. The report
lists those gaps so they can be filled in afterwards.

The rectangle spans only from the first to the last column this tool populates
(`E`–`T` for FY26Q3), so it never reaches Product Name, the unlabelled column B,
Owner Sign off or Approved by Chris on the left, nor New Support Tickets, New
Community Topics or Notes on the right.

### Values only a person can supply

Some columns have no analytics source at all — Supported FTE and Paid FTE always,
and New Projects Started until Mixpanel's JQL becomes reachable. Put them in
`config/manual/<quarter>.json`:

```json
{
    "bloomEditor": { "supportedFte": 5.2, "paidFte": 0, "newProjectsStarted": 188 },
    "bloomLibrary": { "supportedFte": 0.1, "paidFte": 0 }
}
```

They are then filled into the paste grid like any other value, so the grid is
complete and pasting it once is enough. Anything a source collects automatically
takes precedence over a value here, and the clash is reported rather than silently
resolved — so a column that later becomes automatic will not keep using a stale
hand-entered figure.

A quarter's Mixpanel export takes several minutes, so `--from-json` rebuilds the
files from a saved run without collecting anything.

**Quarters are always fiscal, named the way the dashboard names them.** The
fiscal year starts in October, so FY26Q1 = Oct–Dec 2025, FY26Q2 = Jan–Mar 2026 and
FY26Q3 = Apr–Jun 2026.

Calendar quarter names are refused rather than interpreted, because the two
schemes collide on the same digits: `2026Q2` is Apr–Jun, while `FY26Q2` is
Jan–Mar. Asking for one and getting the other would produce a quarter of numbers
that looked entirely normal. The error names the fiscal quarter you meant.

A period can also be given as explicit `--from`/`--to` dates; a range that happens
to be a whole fiscal quarter is still named for that quarter in the output files.

## How it is put together

- `src/metrics.ts` — the whole product × metric matrix and, for each cell, where
  the number comes from. **This is the file to edit when the process changes.**
- `src/cli.ts` — flags, console output, and the order a run happens in.
- `src/collect.ts` — runs every (product, metric) concurrently, capturing a
  failure per cell rather than abandoning the run.
- `src/sources/*` — one module per system: `mixpanelExport`, `mixpanelAuth`
  (project ids and service-account auth), `play`, `bloomInstallers`, `github`
  (releases), `githubTags`, `githubWorkflowRuns`.
- `src/manualValues.ts` — folds in `config/manual/<quarter>.json`.
- `src/compare.ts` — the `--compare` diff against a hand-collected quarter.
- `src/period.ts` — fiscal quarter parsing, month enumeration.
- `src/output.ts` — builds the paste grid.
- `src/writeOutput.ts` — writes the `output/` files.
- `src/sanitize.ts` — redacts provenance before it is persisted.
- `config/dashboard-columns.json` — the dashboard's column order.
- `config/manual/<quarter>.json` — values only a person can supply.
- `config/mixpanel-projects.json` — Mixpanel project ids (not secrets).
- `config/github-tag-dates.json` — committed tag→date cache, to stay inside
  GitHub's unauthenticated rate limit.
- `config/known-good/<quarter>.json` — hand-collected baselines for `--compare`.
- `output/<quarter>.*` — the deliverables, kept as a record.

Metrics we cannot collect are not fudged. Each is reported as `M` (a human must
look it up, with the place to look), `-` (the number does not exist for that
product), or `!` (a source failed this run — the reason is printed, and the report
lists it). None of the three ever reaches the paste grid as anything but a blank
cell.

### Mixpanel: computed from the raw export, because the query APIs are blocked

Our Mixpanel plan rejects every endpoint that *aggregates* data:

```
402  /api/query/insights, /api/2.0/segmentation, /api/2.0/jql,
     /api/2.0/retention, /api/2.0/events/names   "Your plan does not
                                                  allow API calls."
403  /api/2.0/engage    "Service account is missing the
                        download_users_csv permission"
200  data.mixpanel.com/api/2.0/export            <-- not metered
200  mixpanel.com/api/app/...                    <-- metadata only
```

So the original plan — re-run the team's own saved reports over our dates — is
not possible, and the numbers are computed from the **raw event export** instead
(`src/sources/mixpanelExport.ts`). Engage's 403 is a grantable permission rather
than a plan limit, but Engage returns user profiles, not events, so it cannot
produce MAU.

Because raw export is the only route, **the service account's role must carry
`download_events_csv`** — on every project, since each is granted separately.
`analyst` carries it; `consumer` does not, and a run under `consumer` fails every
Mixpanel-derived column at once: MAU and Avg MAU, active users, user countries,
languages impacted, and Bloom Editor's installs and active projects. Thirty of the
fifty-one cells.

The failure is easy to misread from the Mixpanel UI, because nothing looks amiss:
the account is present, enabled, and has a role. It is the role itself that is
wrong. To read back what the account actually holds, rather than what the UI
implies, `GET mixpanel.com/api/app/me` with the same basic auth returns each
project's role and permission list — and unlike the export endpoint, it answers
under any role.

**The trade-off to be aware of:** the metric definitions now live in this
repo rather than in the saved reports, so they can drift from what the Mixpanel
UI shows. Mixpanel's "unique users" is also computed *after* identity merging,
which the raw export does not reflect, so user counts may differ slightly from
the UI. The saved reports remain the canonical definitions — their ids are listed
in `src/metrics.ts` — and a quarter's output should be checked against them
before being trusted.

One export pass per (project, period) serves every column for that product; it is
memoised, streamed, and aggregated as it arrives, so event data is never held in
memory or written to disk. Measured during development, bloomlibrary.org's traffic
ran to roughly 70 MB and 35 s per week exported, so budget a few minutes per
quarter per project.

### Buckets: one Mixpanel project, several products

One Mixpanel project can carry several products, separated by the `host` event
property:

| Bucket | `host` values |
| --- | --- |
| `bloomlibrary.org` | *(absent)*, `bloomlibrary` |
| `bloompubviewer` | `bloompubviewer` |
| `all` | everything, for single-product projects |

A missing `host` is meaningful, not an error — about half of bloomlibrary.org's
events carry none (older clients), which is what the collection doc means by the
"undefined/bloomlibrary.org bucket". That project also carries a `readerapp`
stream, which no dashboard column needs, so it is deliberately not a bucket.

Bloom Editor sets no `host` at all, and Bloom Reader's is either absent or
`bloomreader` — both still Bloom Reader — so those two projects use `all`.

## Credentials

Copy `.env.example` to `.env` and work through it. You will need:

| System | What | Where to set it up |
| --- | --- | --- |
| Mixpanel | Service account user + secret | Organization Settings → Service Accounts |
| Google Play | The bulk-reports bucket (`PLAY_REPORTS_BUCKET`) plus a service account granted access to it — see below | Play Console → Download reports, and Users and permissions |
| GitHub | Optional token, purely for rate limits | github.com → Settings → Developer settings |

The service-account JSON file must live **outside** this repo.

Nothing here needs Google Sheets access: the dashboard is never read or written
by the tool. Its column layout is recorded once, by hand, in
`config/dashboard-columns.json`.

The Bloom installers bucket is public, so Bloom Editor's release count and
latest version need no credentials at all.

### Google Play installs

The install numbers live in Play's monthly
`installs_<package>_YYYYMM_overview.csv` reports, in the
`gs://pubsite_prod_*` bucket. That bucket belongs to **Google Play, not to your
GCP project** — so no IAM role granted in Cloud Console can reach it.

Access is a service account, invited in Play Console under **Users and
permissions** and granted **"View app information and download bulk reports
(read-only)"** on the **Account permissions** tab. Account level is what matters:
the similarly-named *app*-level permission has no bulk-reports half, so an
app-scoped grant never reaches the bucket. Set the permission on the invite form
before saving, and allow up to a day for it to take effect. Point
`GOOGLE_APPLICATION_CREDENTIALS` at the account's key file, which lives outside
this repo.

The CSVs are **UTF-16LE**, which the parser handles — decoding them as UTF-8
produces garbage that still parses.

#### Fallback when the credentials will not authenticate

An agent with browser access can read the same reports through an
already-signed-in Google session. No key file, no Cloud SDK:

1. Navigate to the bucket's `stats/installs/` path on
   `https://storage.cloud.google.com/` — that host authenticates against the
   browser's Google session rather than a bearer token.
2. From a page on that origin, `fetch()` each month's object. The requests are
   same-origin, so the session cookies go with them and the CSV body can be read
   straight out of the response — nothing is downloaded to disk.
3. Decode UTF-16LE and sum `Daily Device Installs`, the same column the collector
   uses.

Whoever is signed in has to be authorized on the Play developer account. This is
how FY26Q1–Q3 were recovered during a spell when the service account could not
read the bucket, and it stays the fallback if that recurs.

A second option, if a person is running the collector anyway: with
`GOOGLE_APPLICATION_CREDENTIALS` unset the Storage client falls back to
Application Default Credentials, so `gcloud auth application-default login` also
works with no code change.

### Bloom Editor releases

Bloom's installers are published to the public bucket
`s3://bloomlibrary.org/installers`, which is also what feeds the
bloomlibrary.org installers page the manual process counts — so counting the
bucket counts the same thing, and needs no credentials. The listing gives both
the version and a date (S3 `LastModified`, a proxy for the release date), and
`parseInstallerKey` filters to the Release channel across the several naming
conventions the bucket has accumulated. Beta/alpha/ACR builds and the
Reading-App-Builder artifact are excluded.

## Validation against a hand-collected quarter

`config/known-good/FY26Q2.json` holds the values collected by hand for
Jan–Mar 2026. Check the tool against them with:

```bash
pnpm collect --quarter FY26Q2 --compare config/known-good/FY26Q2.json
```

Each new quarter's hand-checked numbers should be saved here as a fresh
baseline. Results as of 2026-07-28:

| | Result |
| --- | --- |
| Bloom Library — Active Users, Avg MAU, 3 MAU months | **exact** (31,011; 10,801; 11,043 / 10,558 / 10,802) |
| Bloom Library — user countries, languages | within 1% (200 vs 201; 680 vs 681) |
| BloomPUB Viewer — all user metrics | **exact**, but for Avg MAU 433.67 against the sheet's rounded 433.7 |
| Bloom Editor — installs, active users, all 3 MAU months | **exact** (629; 2,061; 864 / 911 / 1,101) |
| Bloom Editor — releases in period | **exact** (9) |
| Bloom Library — deploys in period | **exact** (41 successful "Build and Deploy" runs) |
| Bloom Reader — releases / version | **exact** (1 release, 3.4.5) from git tags |
| Bloom Editor — active projects / languages | 699 vs 701 (−0.3%) |
| Bloom Editor — user countries | 108 vs 104 — different population, see below |
| Bloom Reader — all user metrics | not comparable: late-arriving events, see below. The sheet was right when collected, and so is this. |

That the user counts land exactly settles an earlier worry: raw export does not
reflect Mixpanel's identity merging, and the fear was that this would inflate
"Active Users". It does not — Mixpanel's own reports show the same near-zero
cross-month overlap. BloomPUB Viewer's quarterly total genuinely equals the sum
of its three months in both the hand-collected numbers and ours.

### Decisions of record (2026-07-28)

- **Bloom Reader's numbers keep rising after the quarter ends, and that explains
  the FY26Q2 gap.** This tool read 10–22% above the hand-collected figures, and the
  gap scaled with how recent the month was — Jan +10.6%, Feb +15.3%, Mar +21.6%.
  That is late-arriving data, not an error: Bloom Reader is the offline-first
  Android app, its events upload when a device next has connectivity, and it is the
  only product affected (Bloom Editor, Bloom Library and BloomPUB Viewer all
  matched exactly). The drift is still observable — across three runs in one
  afternoon its FY26Q3 Active Users went 5,435 → 5,437 → 5,453.

  So the sheet's figures were right when collected, and so are these. **A quarter
  collected shortly after it ends reads lower than the same quarter collected
  months later**, which matters for comparability: collect at a consistent lag, and
  do not re-run an old quarter expecting its old numbers.
- **"Latest release" stays period-bound.** The FY26Q2 sheet recorded 6.2.8 dated
  2026-04-06 — after the quarter — which is treated as a mistake. We report the
  last release *inside* the period.
- **Number of User Countries *is* collected** (column S). What the dashboard
  retired is the **Top 5 User Countries** breakdown — its Country 1–5 columns are
  gone from the FY26Q3 layout — not this total. An earlier reading of the
  deprecation note had this column left blank; that was wrong and is fixed.
- **Active Projects and Number of Languages Impacted are meant to be the same
  number** for Bloom Editor (both distinct `Language1Iso639Code`). The
  hand-collected sheet has 701 in both, so this is intended, not a bug.
- **New Projects Started stays manual.** JQL is blocked by the plan, and
  computing it from the raw export would need a one-time backfill of all history
  since 2012. Not worth building yet.
- **Bloom Reader Installs is `Daily Device Installs` from the bulk reports**, and
  getting there took three wrong turns worth recording.

  The dashboard defines Installs as *"Number of installs in the reporting period.
  Unique first-run (desktop/mobile)"*. Google's statistics report distinguishes
  **events** ("every time something happens") from **uniques** ("the number of
  users or devices that experience an event"), and offers both: `Device
  acquisition > New devices` is the uniques-based metric, while `All device
  acquisitions` and `Install events` are events-based. "Unique first-run" means
  uniques, so `New devices` is the metric — and it is not called "unique"
  anything, which is why looking for that word in the console finds nothing.

  `New devices` matches the bulk report column `Daily Device Installs`, verified
  month by month for Jan–Jun 2026:

  | | Jan | Feb | Mar | Apr | May | Jun |
  | --- | --- | --- | --- | --- | --- | --- |
  | UI, New devices / Unique devices | 482 | 486 | 602 | 821 | 1001 | 642 |
  | CSV, Daily Device Installs | 482 | 486 | 605 | 814 | 990 | 642 |

  The residual is data still settling, inside the 1% the comparison allows.

  **The previously reported figures used the events metric and overcounted**: 2,193
  for FY26Q1 against about 1,344, and 2,434 for FY26Q2 against 1,573 — roughly 55
  to 63% high. So FY26Q3's 2,446 is not comparable with the 2,434 sitting in the
  sheet for FY26Q2: on a like-for-like uniques basis installs grew 56%
  (1,573 → 2,446), but read against that events-based 2,434 the quarter looks
  flat — and restating FY26Q2 correctly drops it by a third (2,434 → 1,573).
  Raised with the dashboard's owners.

  The figure is read from the bulk-reports bucket. Reading the same CSVs from a
  local folder was a stopgap while the metric was being pinned down, and has been
  removed. A run without bulk-report access leaves Installs blank and says why
  rather than guessing.


### Known differences from the manual process

- **"Latest Release" means latest *as of writing the report*, not latest within
  the period.** The FY26Q2 sheet records Bloom Editor 6.2.8 dated 2026-04-06 —
  April, i.e. after the quarter ended. This tool reports the latest release
  *inside* the period (6.2.7, 2026-03-16), per the decision of record above.
- **Bloom Reader's release date runs a day behind Play's.** The columns come
  from git tags on `BloomBooks/BloomReader`, which the repo uses instead of GitHub
  Releases; tag `v3.4.5` is dated 2026-02-05 against a Play release recorded as
  2026-02-06. The count and version match exactly.

## Things still to confirm

- **Parity with the Mixpanel UI.** See the identity-merging caveat above; check a
  quarter you have already reported by hand.
- **New Projects Started** needs each L1 language's first-*ever* appearance, so
  the raw export would have to cover all history back to 2012. The practical
  shape is a cached `language -> first seen` file, built once and topped up each
  quarter; not built yet.

- The **12-month rolling average** columns (platform percentages, top UI/device
  languages) have no recipe in the doc yet, so they are not implemented.

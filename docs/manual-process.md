# The manual process this tool replaces

Transcribed 2026-07-28 from the **Bloom - Analytics Collection** Google Doc,
instructions last updated 12/15/2025. **That document is the source of truth** —
this file is a snapshot so the code can be reviewed without opening it. Note in
the doc when the recipe changes, then update this file and `src/metrics.ts`.

Each heading is a column in the quarterly report of the LangTech Software
Metrics Dashboard. Detailed column definitions live in that spreadsheet.

## Bloom Editor

| Column | Manual recipe |
| --- | --- |
| Latest Release Version and Date | TeamCity → Release build → final one for the fiscal year. *Annual, final quarter only.* |
| Number of Releases | bloomlibrary.org/page/resources/all-bloom-installers → count releases in the period. Release channel only — an attempt to also count Release/Internal/Beta/BetaInternal/Alpha was abandoned as not worth the effort. |
| Downloads | We don't have this information. |
| Installs | Mixpanel → Bloom Editor → LangTech Metrics → (Unique User) Installs. *(Created, Unique Users)* |
| Active Projects | Mixpanel → Bloom Editor → LangTech Metrics → Active L1 languages. *(All Events, Distinct Count Language1Iso639Code)* |
| New Projects Started | Mixpanel → Bloom Editor → Applications → JQL → "count - L1 first seen date is in period", adjusting the dates. Counts languages whose min timestamp for `Language1Iso639Code` falls in range. Collections ≠ projects, so languages are the fallback. |
| Active Users | Mixpanel → Bloom Editor → LangTech Metrics → Active Users. *(All Events, Unique Users)* |
| Avg Monthly Active Users | Mixpanel → Bloom Editor → LangTech Metrics → Avg MAU (open the full report to see the average). *(All Events, Unique Users)* |
| Number of User Countries | Mixpanel → Bloom Editor → create new insight. *(All Events, Aggregate, Distinct Count, Country Code)* |
| Number of Languages Impacted | Mixpanel → Bloom Editor → create new insight. *(All Events, Aggregate, Distinct Count, Language1Iso639Code)* |
| Top 5 User Countries *(deprecated)* | Mixpanel → Bloom Editor → LangTech Metrics → Top User (Unique) Countries. *(All Events, Unique Users, breakdown by User Country Code)* |

## Bloom Reader (release only)

| Column | Manual recipe |
| --- | --- |
| Latest Release Version and Date | Play Console → Bloom Reader → Production → Releases → Release history. *Annual only.* |
| Number of Releases | Same place; count releases in the period. |
| Downloads | Play Console does not distinguish download from install, and direct downloads from bloomlibrary.org aren't tracked. So we don't have it. |
| Installs | Play Console → Statistics → Saved Reports → Installs → sum the month totals. *(All device acquisitions, All events, Per interval, Monthly)* |
| Active Projects / New Projects Started | n/a |
| Active Users | Mixpanel → Bloom Reader Release → LangTech Metrics → Active Users |
| Avg Monthly Active Users | Mixpanel → Bloom Reader Release → LangTech Metrics → Avg MAU |
| Number of User Countries | Mixpanel → Bloom Reader Release → LangTech Metrics → Count of User Countries |
| Number of Languages Impacted | Mixpanel → Bloom Reader Release → LangTech Metrics → Count of Content Languages *(contentLang)* |
| Top 5 User Countries *(deprecated)* | Mixpanel → Bloom Reader Release → LangTech Metrics → Top User (Unique) Countries |

## BloomLibrary.org

Mixpanel numbers come from the **BloomLibrary.org** project, taking the
`undefined`/`bloomlibrary.org` bucket (this project also carries BloomPUB
Viewer traffic).

| Column | Manual recipe |
| --- | --- |
| Latest Release Version and Date | Version n/a; date from GHA → last one in the period. *Annual only.* |
| Number of Releases | GHA → count in the period. |
| Downloads / Installs / Active Projects / New Projects Started | n/a |
| Active Users | LangTech Metrics → Active Users |
| Avg Monthly Active Users | LangTech Metrics → Avg MAU |
| Number of User Countries | LangTech Metrics → Count of User Countries |
| Number of Languages Impacted | LangTech Metrics → Count of Content Languages |
| Top 5 User Countries *(deprecated)* | LangTech Metrics → Top User (Unique) Countries |

## BloomPUB Viewer

Same as BloomLibrary.org, but taking the **`bloompubviewer`** bucket of the
BloomLibrary.org Mixpanel project.

| Column | Manual recipe |
| --- | --- |
| Latest Release Version and Date | GitHub releases → last in the period. *Annual only.* |
| Number of Releases | GitHub releases → count in the period. |
| Downloads / Installs | We don't have this info. |
| Active Projects / New Projects Started | n/a |
| Active Users, Avg MAU, User Countries, Languages Impacted, Top 5 Countries | As above, `bloompubviewer` bucket. |

## Not yet defined in the doc

These columns are listed as "12-month rolling average" and have no recipe yet,
so this tool does not attempt them:

Top 5 UI Languages · Top 5 Device Languages · Windows/Mac/Linux/Android/iOS/Web
percentage · Analytics contain test projects/users

## Where the doc and the sheet disagree

The FY26Q3 sheet is the thing we actually fill in, so where it differs from the
doc, `src/metrics.ts` follows the sheet:

- **Latest Release Version** and **Latest Release Date** are two separate
  columns, not one combined value.
- **Avg MAU is accompanied by one column per month of the quarter** (MAU Apr /
  May / Jun for Q3). The same Mixpanel Avg MAU report supplies all four, since it
  is already a per-month unique-user count.
- **Top 5 User Countries no longer has a column** — the doc already marks it
  deprecated — so it is not collected.
- The sheet has columns with no analytics source, filled in by hand: Owner Sign
  off, Approved by Chris, Supported FTE, Paid FTE, New Support Tickets, New
  Community Topics, Notes/Comments.
- Product rows read Bloom Editor, Bloom Library, Bloom Reader, BloomPUB Viewer,
  under a "Literacy" section heading.

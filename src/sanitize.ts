/**
 * Strips identifying detail out of text before it is written to a file in
 * `output/`, which is committed and — for this repo — published.
 *
 * This exists because of a real leak. A Google Cloud Storage permission error
 * was captured verbatim into a cell's provenance and committed, carrying a
 * service-account address, a GCP project name, the Play bulk-reports bucket
 * (which embeds the Play developer account id), a troubleshooter URL, and in one
 * commit a local path containing the operator's Windows username. None of it was
 * a credential, but none of it belonged in a public repo either.
 *
 * The terminal still shows the unredacted text: whoever is running the tool
 * needs the real bucket name and the real error to fix anything. Only what gets
 * persisted is reduced.
 */

/** An email address anywhere in the text, service accounts included. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** A `gs://bucket/path` URI — the bucket is the sensitive half. */
const GCS_URI = /gs:\/\/([^/\s)]+)(\/[^\s)]*)?/g;

/** The Play bulk-reports bucket names, which encode the developer account id. */
const PUBSITE_BUCKET = /pubsite_prod(?:_rev)?_\d+/g;

/** An absolute Windows or POSIX path; only the last segment is ever useful. */
const ABSOLUTE_PATH = /(?:[A-Za-z]:\\|\/)(?:[^\s,;)"']*[\\/])+([^\s,;)"']+)/g;

/** An http(s) URL. Query strings on these can carry ids and tokens. */
const URL_PATTERN = /https?:\/\/[^\s)"']+/g;

/**
 * Marker for text held back from the later rules. Printable, so the file stays
 * plain text, and shaped so it cannot occur in real provenance — which is only
 * ever metric names, counts, object names, repo names and dates.
 */
const HELD = /__GCS(\d+)__/g;

/**
 * Reduces text to something safe to commit, preserving the parts that explain a
 * number: object and file names, counts, column names, metric names.
 */
export const sanitizeForOutput = (text: string): string => {
    // A redacted `gs://<bucket>/stats/installs/...` still looks like an absolute
    // POSIX path, so the path rule would strip it back to a bare file name and
    // lose the object path we deliberately kept. Hold those aside and reinstate
    // them at the end, so no rule acts on another rule's output.
    const held: string[] = [];
    const withoutGcs = text.replace(GCS_URI, (_match, _bucket, path) => {
        held.push(path ? `gs://<bucket>${path}` : "gs://<bucket>");
        return `__GCS${held.length - 1}__`;
    });

    return withoutGcs
        .replace(PUBSITE_BUCKET, "<play-bucket>")
        .replace(ABSOLUTE_PATH, "$1")
        .replace(EMAIL, "<account>")
        .replace(URL_PATTERN, "<url>")
        // Collapse the whitespace that Google's multi-sentence errors carry, so
        // the report's tables stay readable.
        .replace(/\s+/g, " ")
        .trim()
        .replace(HELD, (_match, index) => held[Number(index)]!);
};

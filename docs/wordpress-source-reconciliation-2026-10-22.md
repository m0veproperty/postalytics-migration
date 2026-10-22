# Postalytics migration source reconciliation
Checked: 2026-10-22 (UTC). Source: authenticated, read-only WPVibe inspection of https://www.postalytics.com. This is an inventory checkpoint, NOT migration approval or a complete redirect export.

## Historical redirects
- Yoast SEO Premium: option `wpseo-premium-redirects-base` contains a PHP-serialized array declaring **673** records; `wpseo-premium-redirects-export-plain` also declares 673. Regex export option declares zero. Do not sum base and export versions: they represent the same rules in different forms. Yoast source-path deduplication found 673 unique normalised origins. Source: WPVibe WP-CLI `option list --search=*redirect*`.
- Rank Math: `wp_rank_math_redirections` has **81 rows** (all 81 currently have status=active; individual destinations and execution order still require verification). Source: WPVibe `db query "SELECT COUNT(*) n FROM {prefix}rank_math_redirections"`.
- `wp_sfm_redirects` has **1 row**, classified as RSS feed redirection to SpecificFeeds, rather than an ordinary URL redirect. Source: WPVibe database row inspection.
- Pretty Links has **2 enabled 301 tracking records**: `/jenni` and `/jennishow`, both currently configured to the homepage. Source: WPVibe `wp_prli_links` rows.
- Of 81 active Rank Math rules, **80 normalised source paths overlap** with Yoast and **one** is unmatched: `/5-ways-to-use-direct-mail-and-email-marketing`. This yields **674 candidate distinct source paths** across these CMS systems (673 + 1), not 754. Of the 80 overlaps, two have divergent configured destinations, listed below. The 80 Yoast rules whose destinations also appear as Yoast source paths are **possible chains** requiring a runtime check; this is not proof of actual multi-hop behaviour. Also inspect web server, CDN, plugins, legacy backups and historical exports.

## Redirect conflict queue
These are **configuration conflicts, not confirmed live behaviour**. Inspect actual HTTP response and decide intended support destination before retaining or retiring either rule.
1. `support/documentation/home/my-account/external-domain`: Yoast → `https://support.postalytics.com/support/solutions/articles/70000600607-vanity-domains-for-direct-mail`; Rank Math → `https://www.postalytics.com/support/documentation/home/my-account/external-domain-setup-for-purls`.
2. `support/documentation/home/my-account/external-domain-setup-for-purls`: Yoast → `https://support.postalytics.com/support/solutions/folders/70000477545`; Rank Math → `https://www.postalytics.com/support/documentation/home/purls-qrs-and-domains/external-domain-setup`.
Source: WPVibe Yoast option `wpseo-premium-redirects-base` and Rank Math table `wp_rank_math_redirections`. Both should remain **unapproved** until verified.

## WordPress content and inactive URLs
Authenticated `wp_posts` query grouped by post_type and post_status:
- Published posts **442**; drafts **62**; one auto-draft and one dp-rewrite-republish status.
- Published pages **349**; drafts **218**; private **5**.
- Captivate podcasts published **48**.
- Docs published **149**, draft **2**, private **3**.
- Attachments inherit **6,288**; `_wp_attached_file` recorded **6,288 distinct paths**.
- Published testimonials **8**; other plugin-owned system types exist and need visibility and URL exposure verification.
- These are database entity counts and **are not unique crawlable URL totals**.

## Taxonomies
WordPress `taxonomy list` exposes category, post_tag, post_format, captivate_category, captivate_tag, portfolio-type, doc_tag and several private/system taxonomies.
Stored term taxonomy counts from `wp_term_taxonomy`: category **26**, post_tag **717**, doc_tag **125**, portfolio-type **4**. Captivate taxonomy registrations may have zero matching term rows. Registration does not imply an indexable archive. Test canonical, noindex, pagination and last page behavior separately.

## Media catalogue
6,288 attachment records have 6,288 distinct `_wp_attached_file` values. MIME breakdown:
- PNG 3,973; JPEG 2,117; GIF 70; PDF 36; AVIF 34; WebP 26; MP4 20; SVG 6; DOCX 2; HEIC 2; ZIP 1; XLSX 1.
- Total 6,288. Source: `wp_posts` WHERE post_type='attachment' GROUP BY post_mime_type.
- **Not yet verified:** upload file existence, generated thumbnail variants, attachment URL redirects, usage references, hotlinked or CSS-based images, or orphan files without DB entries. Each final media-catalog entry should include attachment ID, source upload path, canonical URL, usage, HTTP status, proposed target, decision status and direct source reference.

## Remaining reconciliation gates (open, not approved)
1. Export and parse all **673** Yoast rules; enumerate 81 Rank Math rows and the single sfm row, including active flag, source, target, type, pattern, last changed; identify overlaps, loops, chains and redirects to retired URLs.
2. Obtain legacy CDN / host / .htaccess / backup / original site redirects and any outside-CMS redirect history.
3. Export *all* backlink destination URLs and referring source URLs from Ahrefs, grouped by live, redirected, 404/410 and unobserved. Match against candidate destination and redirects and distinguish unique linked targets from backlink count.
4. Create URL-level registers for published, private, draft, archived, service / conversion journeys, taxonomy and paginated archives, feeds and system routes. Probe canonical, robots directive, redirect chain and current response status.
5. Media file-level reconciliation, including physically present uploads vs registered attachments and derivative formats; source evidence for every resolved entry.
6. Final approval belongs to the migration workspace's designated approvers; these findings do not imply approval or launch readiness.

## Evidence rules
Each reviewed row must have an evidence_source, evidence_checked_at, current_url, suggested_action, target_url when relevant, HTTP status, owner or reviewer, and explicit verification state. Use `unverified` rather than deriving a redirect from title similarity. This document is an aggregate snapshot, not a substitute for the protected, per-URL source inventory.

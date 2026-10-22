# Postalytics migration source reconciliation
Checked: 2026-10-22 (UTC). Source: authenticated, read-only WPVibe inspection of https://www.postalytics.com. This is an inventory checkpoint, NOT migration approval or a complete redirect export.

## Historical redirects
- Yoast SEO Premium: option `wpseo-premium-redirects-base` contains a PHP-serialized array declaring **673** records; `wpseo-premium-redirects-export-plain` also declares 673. Regex export option declares zero. Do not sum base and export versions: they represent the same rules in different forms. Source: WPVibe WP-CLI `option list --search=*redirect*`.
- Rank Math: `wp_rank_math_redirections` has **81 rows** (may include inactive or archived rules; activation and targets still require row-level audit). Source: WPVibe `db query "SELECT COUNT(*) n FROM {prefix}rank_math_redirections"`.
- `wp_sfm_redirects` has **1 row**, not yet classified. Source: WPVibe database count.
- Pretty Links has **2 published** internal records. Source: `wp_posts` post-type/status counts. These may be tracking routes, not migration redirects.
- These sources overlap potentially. **Do not claim 755 unique redirect rules** without deduplication. Also inspect web server, CDN, plugins, legacy backups and historical exports.

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

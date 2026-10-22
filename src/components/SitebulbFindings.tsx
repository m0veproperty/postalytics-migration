'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, DownloadSimple, Info, MagnifyingGlass } from '@phosphor-icons/react';
import './sitebulb.css';

type Severity = 'High' | 'Medium' | 'Low' | 'Verify';
type Finding = { id:string; group:string; url:string; detail:string; action:string; severity:Severity; parent?:string; observation?:string };
const BASE = 'https://www.postalytics.com';
const item=(id:string,group:string,path:string,detail:string,action:string,severity:Severity,parent?:string,observation?:string):Finding=>({id,group,url:path.startsWith('http')?path:BASE+path,detail,action,severity,parent,observation});
const findings:Finding[] = [
 item('BL-01','Broken links','/support/documentation/home/campaigns/smart-send/','404 Not Found confirmed in one Sitebulb row; the same source is also listed as no-response.','Replace links with the current relevant Smart Send documentation after confirming the destination.','High'),
 ...[
 '/support/documentation/home/zapier-integration/zapier-pipedrive-direct-ma',
 '/support/documentation/home/my-account/direct-mail-credits/',
 '/support/documentation/home/campaigns/triggered-drip-campaign/',
 'http://www.postalytics.com/blog/hubspot-postcards-buyers-journey/',
 '/support/documentation/home/creative-templates/pre-built-direct-mail-temp',
 '/support/documentation/home/campaigns/what-is-a-purl/',
 'http://www.postalytics.com/direct-mail-integrations/',
 '/direct-mail-automation-now/',
 '/support/documentation/home/hubspot-integration/',
 '/support/documentation/home/campaigns/smart-send-direct-mail-campaigns/',
 'http://www.postalytics.com/support/documentation/home/campaigns/tracking-code-overview/',
 'http://www.postalytics.com/case-studies/sigma-marketing/',
 '/blog/page/8/','/blog/page/51/','/blog/author/madx/page/6/','/blog/author/madx/page/16/',
 '/blog/category/marketing/page/21/','/blog/page/9/','/blog/author/madx/page/15/',
 '/blog/page/50/','/blog/author/madx/page/7/','/blog/category/marketing/page/22/',
 '/thank-you-nonprofit-playbook/','/captivate-podcast/page/2/'
 ].map((p,i)=>item('BL-'+String(i+2).padStart(2,'0'),'Broken links',p,'Sitebulb reported HTTP -1: No Status Code Returned; not a verified 404. Some URLs are truncated in the supplied export.','Re-crawl with an unrestricted request and check redirect destination, response code and linking parent before fixing.','Verify')),
 ...[
 ['basic-trigger-direct-mail-from-hubspot-contact-object','/case-studies/direct-mail-for-real-estate/'],
 ['campaign-creator-video-overview','/tools/direct-mail/'],
 ['template-editor-overview-video','/tools/email-to-mail/'],
 ['import-hubspot-lists-for-smart-send-campaigns','/blog/sending-your-first-mail-campaign/'],
 ['purchase-a-mailing-list','/blog/better-landscaping-postcards/'],
 ].map(([slug,parent],i)=>item('EX-'+String(i+1).padStart(2,'0'),'External redirect failures','https://support.postalytics.com/'+slug,'Postalytics support redirect terminates at a Sitebulb-reported 404.','Correct the link on the parent page and restore or redirect the relevant knowledge-base destination.','High',BASE+parent,'Redirect destination: 404')),
 ...[
 ['https://apwu.org/postal-service-reform-act-2022','/blog/marketing-agencies-add-direct-mail/','404'],
 ['https://www.boingnet.com/2016/08/12/ad-blocking-happens-for-a-reason/','/blog/why-consumers-trust-direct-mail-marketing/','404'],
 ['https://www.boingnet.com/2014/02/10/landing-pages-every-campaign/','/blog/why-consumers-trust-direct-mail-marketing/','404'],
 ['https://www.guru.com/errors/pagenotfound.aspx','/blog/direct-mail-process/','404'],
 ['https://mobilize-fs.cz/','/blog/direct-mail-examples/','403'],
 ['https://eu.usatoday.com/story/money/economy/2018/07/05/cities-americans-growing-population-migration','/blog/bang-for-buck/','500'],
 ['https://www.boingnet.com/2017/08/16/iphone-qr-code-reader/','/blog/google-lens-makes-offline-to-online-marketing-easy/','404'],
 ['https://webgraphicsinc.com/single-post/2016/04/21/10-Statistics-that-Demonstrate-the-Power-of-Direct','/blog/b2b-direct-mail-marketing-infographic/','404'],
 ['https://events.hubspot.com/AustinHUG','/blog/hubspot-workflows-18-expert-insights/','404'],
 ['https://www.boingnet.com/2017/02/06/consumers-trust-direct-mail/','/blog/facebook-will-use-automated-postcards/','404'],
 ['https://www.boingnet.com/2016/11/03/avoid-spam-filters/','/blog/5-ways-to-use-direct-mail-and-email-marketing/','404'],
 ['https://www.business2community.com/digital-marketing/5-most-profitable-online-course-ideas-of-2021-0','/blog/sell-online-courses/','404'],
 ['https://www.rev.com/account/auth/login','', '405'],
 ['https://linkshortener.platform.prod.us-west-2.tunein.com/tjcD87','/blog/commerce-marketer-podcast-with-greg-zakowicz/','405'],
 ['https://www.uspsoig.gov/focus-areas/blog-post/postal-service-and-its-obligation','/blog/does-usps-deliver-on-sunday/','403'],
 ].map(([url,parent,status],i)=>item('EX-'+String(i+6).padStart(2,'0'),'External redirect failures',url,'An external URL redirects to a Sitebulb-reported '+status+' response. Destination may have changed since the crawl.','Recheck in a browser; update or remove the original outbound link, retaining an authoritative relevant citation.','Medium',parent?BASE+parent:undefined,'Redirect destination: '+status)),
 ...['/tools/direct-mail/','/blog/agency-tools/','/blog/where-to-buy-postcards/'].map((p,i)=>item('MH-'+(i+1),'Malformed href',p,'One malformed outgoing href detected on this indexable page.','Identify the exact anchor in HTML and correct the href to a valid target.','Medium')),
 item('DT-01','Duplicate metadata','/tools/mailback-automated-postal-retargeting/','Same indexable title and meta description as /tools/website-retargeting-with-direct-mail/.','Choose a primary commercial page; differentiate metadata or consolidate where intent and content overlap.','High'),
 item('DT-02','Duplicate metadata','/tools/website-retargeting-with-direct-mail/','Same indexable title and meta description as /tools/mailback-automated-postal-retargeting/.','Check canonical, internal links and content intent before resolving duplication.','High'),
 ...[
 ['/blog/canva-mailers-comparison-guide/?utm_source=chatgpt.com','/blog/canva-direct-mail-webinar/'],
 ['/blog/canva-direct-mail/?utm_source=chatgpt.com','/blog/canva-direct-mail-webinar/'],
 ['/blog/broadband-marketing/?utm_source=chatgpt.com','/blog/isp-marketing-strategy/'],
 ['/?utm_source=Google&utm_medium=cpc','/blog/usps-no-access-to-delivery-location/'],
 ].map(([p,parent],i)=>item('TP-'+(i+1),'Tracking parameters',p,'200 response, canonicalized to the clean URL. UTM-tagged href appears internally.','Replace the internal link with its clean canonical URL; retain campaign tracking on genuine external acquisition links.','Low',BASE+parent)),
 ...[2,3,4,5].map((page)=>item('CN-P'+page,'Canonical anomalies','/podcast/page/'+page+'/','Paginated podcast archive canonicalizes to /podcast/.','Check whether pagination contains unique discoverable items; use self-canonical pages when appropriate and fix archive navigation.','Medium')),
 ...[
 ['/blog/author/joebrownpostalytics-com/','/blog/author/samnallen/?mab_v3=16816'],
 ['/blog/author/joebrownpostalytics-com/?mab_v3=10059','/blog/author/samnallen/?mab_v3=16816'],
 ['/blog/author/joebrownpostalytics-com/?mab_v3=16448','/blog/author/samnallen/?mab_v3=16816'],
 ['/blog/author/samnallen/?mab_v3=16527','/blog/author/samnallen/?mab_v3=16816'],
 ].map(([p,d],i)=>item('CN-A'+(i+1),'Canonical anomalies',p,'Author archive canonicalizes to '+d+'.','Review author consolidation, remove test/variant parameters from canonical URLs and ensure signals are consistent.','Medium')),
 ...[
 ['/blog/canva-mailers-comparison-guide/?utm_source=chatgpt.com','/blog/canva-mailers-comparison-guide/'],
 ['/blog/canva-direct-mail/?utm_source=chatgpt.com','/blog/canva-direct-mail/'],
 ['/blog/broadband-marketing/?utm_source=chatgpt.com','/blog/broadband-marketing/'],
 ['/?utm_term=&utm_campaign=&utm_source=Google&utm_medium=cpc&hsa_acc=927619','/'],
 ['/Case-Studies/Dynamic-Content-In-Direct-Mail/','/case-studies/dynamic-content-in-direct-mail/'],
 ].map(([p,d],i)=>item('CN-V'+(i+1),'Canonical anomalies',p,'Canonical points to '+d+'. Some are expected query/case normalization.','Leave valid normalization intact; remove internal tracking links and assess any incorrect canonical separately.','Low'))
];
const groups=['All issues','Broken links','External redirect failures','Malformed href','Duplicate metadata','Tracking parameters','Canonical anomalies'];
const counts:Record<string,number>={ 'Broken links':26,'External redirect failures':20,'Malformed href':3,'Duplicate metadata':2,'Tracking parameters':4,'Canonical anomalies':13};
function escapeCSV(x:unknown){return '"'+String(x??'').replaceAll('"','""')+'"';}
export default function SitebulbFindings(){
 const [group,setGroup]=useState('All issues');
 const [query,setQuery]=useState('');
 const [severity,setSeverity]=useState('All priorities');
 const visible=useMemo(()=>findings.filter(f=>(group==='All issues'||f.group===group)&&(severity==='All priorities'||f.severity===severity)&&(!query||[f.id,f.url,f.detail,f.parent,f.action].join(' ').toLowerCase().includes(query.toLowerCase()))),[group,severity,query]);
 const csv=()=>{const lines=[['Reference','Issue type','Priority','URL','Sitebulb finding','Recommended action','Parent URL','Source','Status'].map(escapeCSV).join(','),...visible.map(f=>[f.id,f.group,f.severity,f.url,f.detail,f.action,f.parent||'','Sitebulb crawl supplied 22 October 2026','To verify'].map(escapeCSV).join(','))].join('\r\n');const blob=new Blob([lines],{type:'text/csv;charset=utf-8'});const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download='Postalytics_Sitebulb_Technical_Findings.csv';a.click();URL.revokeObjectURL(href);};
 return <div className="sb-root">
 <div className="sb-intro"><div><h2>Sitebulb crawl findings</h2><p>68 observations across six issue groups, plus 44 internal redirect entries in the supplementary crawl. These are recorded findings and remediation recommendations, not confirmed completed fixes.</p></div><span className="sb-source">Source: Sitebulb crawl · Supplied 22 October 2026</span></div>
 <div className="sb-counters">{[['26','Broken-link observations'],['20','External redirect failures'],['3','Malformed href pages'],['2','Duplicate metadata URLs'],['4','Tracking parameter URLs'],['13','Canonical observations']].map(([n,l])=><div className="sb-counter" key={l}><strong>{n}</strong><span>{l}</span></div>)}</div>
 <div className="sb-note"><Info size={19}/><p><strong>Interpretation matters.</strong> Sitebulb HTTP -1 means no status code was returned, not an observed 404. One Smart Send URL also appears with a verified 404. The external redirect list mixes Postalytics-controlled help URLs with third-party links. Several crawl-export URLs are truncated and must be retrieved in full before implementation.</p></div>
 <div className="sb-section-header"><div><h2>Issue register</h2><p>Filter by type or priority, inspect a source URL, and export the current selection for QA.</p></div><button type="button" className="button button-secondary" onClick={csv}><DownloadSimple size={17}/>Export CSV</button></div>
 <div className="sb-tabs">{groups.map(g=><button type="button" key={g} className={g===group?'selected':''} onClick={()=>setGroup(g)}>{g} <span>{g==='All issues'?68:counts[g]}</span></button>)}</div>
 <div className="sb-controls"><label className="sb-search"><MagnifyingGlass size={17}/><input aria-label="Search Sitebulb findings" placeholder="Search URL, issue, recommendation..." value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Filter priority" value={severity} onChange={e=>setSeverity(e.target.value)}>{['All priorities','High','Medium','Low','Verify'].map(x=><option key={x}>{x}</option>)}</select></div>
 <p className="sb-results">{visible.length} matching observations · Status: To verify</p>
 <div className="sb-table-wrap"><table className="sb-table"><thead><tr><th>Finding</th><th>Issue / source</th><th>Recommended next step</th><th>Priority</th></tr></thead><tbody>{visible.map(f=><tr key={f.id}><td><strong className="sb-id">{f.id}</strong><span className="sb-small">{f.group}</span></td><td><a href={f.url} target="_blank" rel="noopener noreferrer" className="sb-url">{f.url.replace(/^https?:\/\//,'')}<ArrowUpRight size={13}/></a><p>{f.detail}</p>{f.parent&&<span className="sb-small">Linked from: <a href={f.parent} target="_blank" rel="noopener noreferrer">{f.parent.replace(/^https?:\/\//,'')}</a></span>}</td><td>{f.action}</td><td><span className={'sb-priority sb-'+f.severity.toLowerCase()}>{f.severity}</span></td></tr>)}</tbody></table>{!visible.length&&<p className="sb-empty">No findings match these filters.</p>}</div>
 <div className="sb-followup"><h3>Internal redirected URLs · 44 Sitebulb entries</h3><p>The supplied second export contains 44 observations, including protocol normalization, documentation redirects through the old WordPress routes to the support subdomain, and a redirect to a reported 404 at <strong>/support/documentation/home/campaigns/smart-send/</strong>. Some records are successive hops in the same redirect chain. The export also truncates several target URLs, so final endpoint testing and link replacements must be based on full URLs.</p><p><strong>Priority:</strong> update internal links to their verified final destination instead of relying on intermediate 301s; distinguish expected HTTP-to-HTTPS redirects from multi-hop support migrations; verify external support destinations before changing URLs.</p><span>Source: accompanying “Internal redirected URLs” Sitebulb export, 44 rows, supplied 22 October 2026. Full source retained in this conversation, not copied into public application assets.</span></div>
 </div>;
}

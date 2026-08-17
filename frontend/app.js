const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => [...p.querySelectorAll(s)];

const ICONS = {
  home: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z"/></svg>',
  explore: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5M11 8v6M8 11h6"/></svg>',
  library: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v18H7.5A2.5 2.5 0 0 0 5 22V4.5ZM5 4.5V18"/></svg>',
  updates: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h10M4 12h16M4 17h8"/><path d="m16 4 4 3-4 3"/></svg>',
  history: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></svg>',
  bookmark: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.3L6 21V4.5Z"/></svg>',
  settings: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9.5 3 .5 2.2a7.8 7.8 0 0 0-2.1 1.2L5.9 5.2l-1.8 1.8 1.2 2a7.8 7.8 0 0 0-1.1 2.2L2 11.5v2.5l2.2.3c.3.8.7 1.5 1.2 2.1l-1.1 2 1.8 1.8 2-1.2c.7.5 1.4.9 2.2 1.1L9.5 22h2.5l.3-2.2c.8-.3 1.5-.7 2.1-1.2l2 1.1 1.8-1.8-1.2-2c.5-.7.9-1.4 1.1-2.2L20 14v-2.5l-2.2-.3c-.3-.8-.7-1.5-1.2-2.1l1.1-2-1.8-1.8-2 1.2c-.7-.5-1.4-.9-2.2-1.1L12 3h-2.5Z"/><circle cx="11" cy="12.5" r="3"/></svg>',
  sun: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  bell: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  search: '<svg class="icon search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  play: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5Z"/></svg>',
  chevron: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9 18 6-6-6-6"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m15 18-6-6 6-6"/></svg>',
  fullscreen: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>',
  refresh: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.3 6.4L3 16M3 21v-5h5"/></svg>',
};

// ── Security: every dynamic string that reaches innerHTML goes through
// escapeXml. Titles, descriptions, authors, artists, genres, chapter
// labels, search queries — all provider-or-user supplied, all escaped.
function escapeXml(v){return String(v==null?'':v).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));}
// Every <img src> that came from a provider (cover URLs, page image URLs)
// goes through this — only http(s) and our own generated data:image/svg+xml
// placeholders are allowed. Anything else (javascript:, data:text/html,
// etc.) is replaced with a neutral inline placeholder rather than rendered.
function safeImgSrc(url){
  if(typeof url!=='string') return placeholderCover('');
  const trimmed=url.trim();
  if(/^https?:\/\//i.test(trimmed)) return trimmed;
  if(/^data:image\/svg\+xml/i.test(trimmed)) return trimmed;
  return placeholderCover('');
}
// Every external/source link goes through this before being used as an
// href — rejects javascript:, data:, vbscript: and similar dangerous
// schemes; only http(s) is allowed for outbound links.
function safeHref(url){
  if(typeof url!=='string') return '#';
  const trimmed=url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '#';
}
function placeholderCover(title){
  const words=(title||'BUFU').split(' ').map(x=>x[0]).slice(0,2).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 820"><rect width="600" height="820" fill="#0d0f13"/><text x="42" y="753" fill="#ffffff" fill-opacity=".7" font-family="Arial, sans-serif" font-size="34" font-weight="800">${escapeXml(words)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
function fmt(n){n=Number(n)||0;return n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?(n/1000).toFixed(n<10000?1:0)+'K':String(n)}

// ── Centralized API client ────────────────────────────────────────────
// Every frontend request to the BUFU worker goes through here. Handles
// 401 (clears the session), 403/404/429/500, network failures, timeouts,
// and invalid JSON — callers get a consistent {ok,status,data,error} shape
// instead of having to each guess how fetch() can fail.
function apiBaseConfigured(){return !!(window.BUFU_CONFIG?.apiBase)}
async function apiFetch(path, options={}){
  const base=(window.BUFU_CONFIG?.apiBase||'').replace(/\/$/,'');
  if(!base) return {ok:false,status:0,data:null,error:'BUFU is not connected to a Worker yet (config.js apiBase is empty).'};
  const headers={...(options.headers||{})};
  if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
  if(state.auth?.token) headers.Authorization=`Bearer ${state.auth.token}`;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  let res;
  try{
    res=await fetch(base+path,{...options,headers,signal:controller.signal});
  }catch(e){
    clearTimeout(timeout);
    return {ok:false,status:0,data:null,error: e?.name==='AbortError' ? 'Request timed out.' : 'Network error — check your connection.'};
  }
  clearTimeout(timeout);
  let data=null;
  try{ data = await res.json(); }catch{ data=null; }
  if(res.status===401){ if(state.auth) saveAuth(null); return {ok:false,status:401,data,error:data?.error||'Session expired — please sign in again.'}; }
  if(res.status===403) return {ok:false,status:403,data,error:data?.error||'Not permitted.'};
  if(res.status===404) return {ok:false,status:404,data,error:data?.error||'Not found.'};
  if(res.status===429) return {ok:false,status:429,data,error:data?.error||'Too many requests — please slow down.'};
  if(res.status>=500) return {ok:false,status:res.status,data,error:'BUFU is having trouble reaching its backend. Try again shortly.'};
  if(!res.ok) return {ok:false,status:res.status,data,error:data?.error||`Request failed (${res.status}).`};
  return {ok:true,status:res.status,data,error:null};
}

function loadAuth(){try{return JSON.parse(localStorage.getItem('bufu_auth')||'null')}catch{return null}}
function saveAuth(a){state.auth=a; try{ a?localStorage.setItem('bufu_auth',JSON.stringify(a)):localStorage.removeItem('bufu_auth'); }catch{}}
function loadTheme(){try{return localStorage.getItem('bufu_theme')||'system'}catch{return 'system'}}
function loadReaderMode(){try{return localStorage.getItem('bufu_reader_mode')||'auto'}catch{return 'auto'}}

const state={
  auth: loadAuth(),
  modal: null,
  theme: loadTheme(),
  readerMode: loadReaderMode(),
  search: '',
  exploreType: 'all',
  exploreSort: 'popular',
  remoteSearch: [],
  searching: false,
  searchError: null,
  home: {loaded:false, loading:false, items:[], error:null},
  library: {loaded:false, items:[]},
  bookmarks: {loaded:false, items:[]},
  history: {loaded:false, items:[]},
  updates: {loaded:false, items:[]},
  progress: new Map(),        // titleId -> {chapterId, chapterNumber, pageIndex, scrollRatio, completed, updatedAt}
  titleCache: new Map(),      // titleId -> title object | 'not-found'
  chaptersCache: new Map(),   // titleId -> chapters[] | 'error'
  pagesCache: new Map(),      // "titleId|chapterId" -> pages[] | 'error'
};
loadLocalProgress();

function loadLocalProgress(){
  try{
    const raw=JSON.parse(localStorage.getItem('bufu_progress')||'{}');
    state.progress=new Map(Object.entries(raw));
  }catch{}
}
let progressWriteTimer=null;
function persistProgressLocally(){
  clearTimeout(progressWriteTimer);
  // Throttled, not written on every scroll tick.
  progressWriteTimer=setTimeout(()=>{
    try{ localStorage.setItem('bufu_progress', JSON.stringify(Object.fromEntries(state.progress))); }catch{}
  }, 500);
}

function toast(message){const root=$('#toast-root');const el=document.createElement('div');el.className='toast';el.textContent=message;root.appendChild(el);setTimeout(()=>el.remove(),2600)}
function nav(path){location.hash=path}
function currentPath(){return location.hash.replace(/^#/,'')||'/'}
function applyTheme(){
  const mode=state.theme;
  const resolved = mode==='system' ? (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light':'dark') : mode;
  document.documentElement.setAttribute('data-theme', resolved==='light' ? 'light':'dark');
}
window.matchMedia?.('(prefers-color-scheme: light)')?.addEventListener?.('change', ()=>{ if(state.theme==='system') applyTheme(); });

// ── Auth ────────────────────────────────────────────────────────────
async function doRegister(email,password,displayName){
  const r=await apiFetch('/api/auth/register',{method:'POST',body:JSON.stringify({email,password,displayName})});
  if(!r.ok) throw new Error(r.error);
  saveAuth({token:r.data.token,user:r.data.user});
  await hydrateAll();
}
async function doLogin(email,password){
  const r=await apiFetch('/api/auth/login',{method:'POST',body:JSON.stringify({email,password})});
  if(!r.ok) throw new Error(r.error);
  saveAuth({token:r.data.token,user:r.data.user});
  await hydrateAll();
}
async function doLogout(){
  await apiFetch('/api/auth/logout',{method:'POST'}).catch(()=>{});
  saveAuth(null);
  state.library={loaded:false,items:[]}; state.bookmarks={loaded:false,items:[]};
  state.history={loaded:false,items:[]}; state.updates={loaded:false,items:[]};
  toast('Signed out'); render();
}
async function restoreSession(){
  if(!state.auth?.token) return;
  const r=await apiFetch('/api/auth/me');
  if(!r.ok || !r.data?.user){ saveAuth(null); return; }
  state.auth.user=r.data.user; saveAuth(state.auth);
  await hydrateAll();
}
// A fresh device (or a fresh login) recovers everything from D1 directly —
// each endpoint already returns full canonical title metadata joined
// server-side, so there is no N+1 fan-out here and nothing depends on
// titles already being in frontend memory.
async function hydrateAll(){
  if(!state.auth?.token) return;
  const [lib,bm,hist,upd,prog] = await Promise.all([
    apiFetch('/api/me/library'), apiFetch('/api/me/bookmarks'), apiFetch('/api/me/history'), apiFetch('/api/me/updates'), apiFetch('/api/me/progress')
  ]);
  if(lib.ok) state.library={loaded:true, items: lib.data.items||[]};
  if(bm.ok) state.bookmarks={loaded:true, items: bm.data.items||[]};
  if(hist.ok) state.history={loaded:true, items: hist.data.items||[]};
  if(upd.ok) state.updates={loaded:true, items: upd.data.items||[]};
  if(prog.ok) mergeServerProgress(prog.data.progress||[]);
  render();
}
// Merges D1 progress into local state — this is what lets "remember where
// I stopped reading" survive a login on a second device. Per-title,
// newest updatedAt wins; server rows are never blindly applied over
// local ones that are actually more recent (e.g. read on this device
// while offline, not yet synced up).
function mergeServerProgress(rows){
  for(const r of rows){
    const titleId=r.title_id; if(!titleId) continue;
    const server={
      chapterId:r.chapter_id, chapterNumber:r.chapter_number, pageIndex:r.page_index||0,
      scrollRatio:r.scroll_ratio||0, completed:!!r.completed, updatedAt:r.updated_at,
    };
    const local=state.progress.get(titleId);
    if(!local || !local.updatedAt || new Date(server.updatedAt).getTime() > new Date(local.updatedAt).getTime()){
      state.progress.set(titleId, server);
    }
  }
  persistProgressLocally();
}
function libraryStatus(titleId){ return state.library.items.find(x=>x.title_id===titleId)?.status || null; }
function isBookmarked(titleId){ return state.bookmarks.items.some(x=>x.title_id===titleId); }

async function toggleLibrary(titleId, add){
  if(!state.auth?.token){ state.modal='login'; renderModal(); return; }
  if(add){
    const r=await apiFetch('/api/me/library',{method:'PUT',body:JSON.stringify({titleId,status:'reading'})});
    if(!r.ok){ toast(r.error); return; }
    toast('Added to library');
  }else{
    const r=await apiFetch('/api/me/library?titleId='+encodeURIComponent(titleId),{method:'DELETE'});
    if(!r.ok){ toast(r.error); return; }
    toast('Removed from library');
  }
  const lib=await apiFetch('/api/me/library'); if(lib.ok) state.library={loaded:true,items:lib.data.items||[]};
  render();
}
async function toggleBookmark(titleId, remove){
  if(!state.auth?.token){ state.modal='login'; renderModal(); return; }
  const r=await apiFetch('/api/me/bookmarks',{method:'PUT',body:JSON.stringify({titleId,remove})});
  if(!r.ok){ toast(r.error); return; }
  toast(remove?'Removed from bookmarks':'Saved to bookmarks');
  const bm=await apiFetch('/api/me/bookmarks'); if(bm.ok) state.bookmarks={loaded:true,items:bm.data.items||[]};
  render();
}
async function recordHistory(titleId, chapterId){
  if(!state.auth?.token) return;
  apiFetch('/api/me/history',{method:'POST',body:JSON.stringify({titleId,chapterId})}).catch(()=>{});
}
let progressSyncTimer=null;
function syncProgressToServer(titleId, chapterId, chapterNumber, pageIndex, scrollRatio, completed){
  if(!state.auth?.token) return;
  clearTimeout(progressSyncTimer);
  progressSyncTimer=setTimeout(()=>{
    apiFetch('/api/me/progress',{method:'PUT',body:JSON.stringify({titleId,chapterId,chapterNumber,pageIndex,scrollRatio,completed})}).catch(()=>{});
  }, 900);
}
function setProgress(titleId, chapterId, chapterNumber, pageIndex, scrollRatio, completed){
  state.progress.set(titleId, {chapterId, chapterNumber, pageIndex, scrollRatio, completed, updatedAt:new Date().toISOString()});
  persistProgressLocally();
  syncProgressToServer(titleId, chapterId, chapterNumber, pageIndex, scrollRatio, completed);
}
function getProgress(titleId){ return state.progress.get(titleId) || null; }

// Mirrors worker/src/orchestrator.ts's pickLatestChapter: explicit
// selection, never a bare chapters[0] array-order assumption. Numbered
// chapters win (highest number, tie-broken by volume then publish date);
// only an all-unnumbered/special list falls back to most-recently-published.
function pickLatestChapter(chapters){
  if(!Array.isArray(chapters) || !chapters.length) return null;
  const numbered = chapters.filter(c=>typeof c.number==='number');
  const pool = numbered.length ? numbered : chapters;
  let best = pool[0];
  for(const c of pool.slice(1)){
    const cNum = typeof c.number==='number' ? c.number : -Infinity, bNum = typeof best.number==='number' ? best.number : -Infinity;
    if(cNum!==bNum){ if(cNum>bNum) best=c; continue; }
    const cVol = Number(c.volume)||-Infinity, bVol = Number(best.volume)||-Infinity;
    if(cVol!==bVol){ if(cVol>bVol) best=c; continue; }
    const cDate = c.publishedAt ? Date.parse(c.publishedAt) : -Infinity;
    const bDate = best.publishedAt ? Date.parse(best.publishedAt) : -Infinity;
    if(cDate>bDate) best=c;
  }
  return best;
}

// ── Data fetch/cache helpers ──────────────────────────────────────────
async function ensureTitle(id){
  if(state.titleCache.has(id)) return state.titleCache.get(id);
  const r=await apiFetch(`/api/title/${encodeURIComponent(id)}`);
  const value = r.ok ? r.data.title : (r.status===404 ? 'not-found' : 'error');
  state.titleCache.set(id, value);
  return value;
}
async function ensureChapters(id){
  if(state.chaptersCache.has(id)) return state.chaptersCache.get(id);
  const r=await apiFetch(`/api/title/${encodeURIComponent(id)}/chapters`);
  const value = r.ok ? (r.data.chapters||[]) : 'error';
  state.chaptersCache.set(id, value);
  return value;
}
async function fetchPages(titleId, chapterId){
  const key=`${titleId}|${chapterId}`;
  const r=await apiFetch(`/api/title/${encodeURIComponent(titleId)}/chapter/${encodeURIComponent(chapterId)}/pages`);
  const value = r.ok ? (r.data.pages||[]) : 'error';
  state.pagesCache.set(key, value);
  return value;
}
async function loadHomeFeed(){
  if(state.home.loaded || state.home.loading) return;
  state.home.loading=true;
  const r=await apiFetch('/api/recommendations?category=action');
  state.home.loading=false;
  if(r.ok){ state.home={loaded:true, loading:false, items:r.data.results||[], error:null}; }
  else { state.home={loaded:true, loading:false, items:[], error:r.error}; }
  if(currentPath()==='/'||currentPath()==='') render();
}
async function runSearch(q){
  if(!q.trim()) return;
  state.searching=true; state.searchError=null; render();
  const r=await apiFetch('/api/search?q='+encodeURIComponent(q));
  state.searching=false;
  if(r.ok){ state.remoteSearch=r.data.results||[]; state.searchError=null; }
  else { state.remoteSearch=[]; state.searchError=r.error; }
  render();
}

function card(t,{showProgress=true}={}){
  const p=getProgress(t.id);
  const hasUpdate=state.updates.items.some(u=>u.title_id===t.id);
  const cover=safeImgSrc(t.cover);
  return `<article class="card" data-title-id="${escapeXml(t.id)}"><button class="card-more" data-action="bookmark" data-title-id="${escapeXml(t.id)}" data-bookmarked="${isBookmarked(t.id)}" aria-label="Bookmark">${ICONS.bookmark}</button><div class="cover"><img class="cover-art" src="${cover}" alt="${escapeXml(t.title)} cover" loading="lazy" onerror="this.onerror=null;this.src='${placeholderCover(t.title)}'"><div class="cover-overlay"></div>${!t.readable?'<div class="badge" style="background:#3a3f47">METADATA</div>':''}${hasUpdate?'<div class="badge" style="background:var(--accent)">NEW</div>':''}</div><div class="card-body"><div class="card-title">${escapeXml(t.title)}</div><div class="card-meta"><span>${p?`Ch. ${escapeXml(String(p.chapterNumber??'—'))}`:escapeXml(t.type||'—')}</span><span>${t.score?`★ ${escapeXml(String(t.score))}`:''}</span></div>${showProgress&&p?`<div class="card-progress"><span style="width:${progressPercent(p)}%"></span></div>`:''}</div></article>`;
}
function progressPercent(p){
  if(!p) return 0;
  if(p.scrollRatio) return Math.max(0,Math.min(100,Math.round(p.scrollRatio*100)));
  return p.completed ? 100 : 30;
}

function sidebar(active){
  const items=[['home','Home','/'],['explore','Explore','/explore'],['library','Library','/library'],['updates','Updates','/updates'],['history','History','/history'],['bookmark','Bookmarks','/bookmarks']];
  const updatesCount=state.updates.items.length;
  return `<aside class="sidebar"><a class="brand" href="#/" aria-label="BUFU"><img src="./assets/bufu-mark.png" alt="BUFU logo"></a><nav class="nav">${items.map(([icon,label,path])=>`<a class="nav-item ${active===path?'active':''}" href="#${path}">${ICONS[icon]}<span class="nav-label">${label}</span>${icon==='updates'&&updatesCount?`<span class="updates-badge">${updatesCount>9?'9+':updatesCount}</span>`:''}</a>`).join('')}</nav><div class="sidebar-spacer"></div><div class="side-footer"><a class="bottom-item ${active==='/settings'?'active':''}" href="#/settings">${ICONS.settings}<span class="nav-label">Settings</span></a><button class="avatar" data-action="profile">${avatarLabel()}</button></div></aside>`;
}
function mobileNav(active){return `<nav class="mobile-nav">${[['home','Home','/'],['explore','Explore','/explore'],['library','Library','/library'],['history','History','/history'],['bookmark','Saved','/bookmarks']].map(([i,l,p])=>`<button class="${active===p?'active':''}" data-nav="${p}">${ICONS[i]}<span>${l}</span></button>`).join('')}</nav>`}
function topbar(){return `<div class="topbar"><div class="search">${ICONS.search}<input id="global-search" value="${escapeXml(state.search)}" placeholder="Search manga or manhwa..." aria-label="Search manga or manhwa"></div><div class="topbar-spacer"></div><button class="avatar" data-action="profile">${avatarLabel()}</button></div>`}
function avatarLabel(){ if(state.auth?.user){ const n=state.auth.user.displayName||state.auth.user.email||'U'; return escapeXml(n[0].toUpperCase()) } return '+' }

function notConnectedNotice(){
  return apiBaseConfigured() ? '' : `<div class="empty" style="margin-bottom:16px"><h3>Not connected to a BUFU Worker</h3><p>Set <code>apiBase</code> in config.js to your deployed Cloudflare Worker URL to load real titles.</p></div>`;
}

function home(){
  if(!state.home.loaded && apiBaseConfigured()) setTimeout(loadHomeFeed,0);
  const items=state.home.items;
  const featured = items[0];
  return `<div class="page-enter">${notConnectedNotice()}
  ${featured?`<section class="hero"><div class="hero-bg"></div><div class="hero-content"><div class="kicker"><span class="pulse"></span> Trending now</div><h1>Read beyond worlds.</h1><p>One home for manga, manhwa and manhua — a unified library, source fallback, and a reader that remembers exactly where you stopped.</p><div class="actions"><button class="btn btn-primary" data-nav="/title/${escapeXml(featured.id)}">${ICONS.play} Read ${escapeXml(featured.title)}</button><button class="btn btn-ghost" data-nav="/explore">Explore catalog</button></div></div></section>`:''}
  <section class="section"><div class="section-head"><div class="section-title">Recommended</div><a class="section-link" href="#/explore">View all</a></div>
  ${state.home.loading?`<div class="empty"><h3>Loading recommendations…</h3></div>`
   :state.home.error?`<div class="empty"><h3>Couldn't load recommendations</h3><p>${escapeXml(state.home.error)}</p><button class="btn btn-ghost" data-action="retry-home">${ICONS.refresh} Retry</button></div>`
   :items.length?`<div class="cover-grid">${items.map(t=>card(t)).join('')}</div>`
   :apiBaseConfigured()?`<div class="empty"><h3>Nothing to show yet</h3><p>Try Explore to search the catalog directly.</p></div>`:''}
  </section></div>`;
}

function explore(){
  const q=state.search.trim();
  const list=(q?state.remoteSearch:[]).filter(t=>state.exploreType==='all'||t.type===state.exploreType);
  if(state.exploreSort==='rating') list.sort((a,b)=>(b.score||0)-(a.score||0));
  else list.sort((a,b)=>(b.popularity||0)-(a.popularity||0));
  return `<div class="page-enter">${notConnectedNotice()}
  <section class="explore-hero"><div class="explore-banner"><div class="kicker"><span class="pulse"></span> Discover</div><h2>Find your next obsession.</h2><p>Search once — BUFU merges the same title across every connected metadata source into one clean result, and marks whether it's readable through MangaDex.</p></div></section>
  <section class="section"><div class="section-head"><div class="section-title">${q?`Results for "${escapeXml(q)}"`:'Search the catalog'}</div>${q?`<span style="color:#676e79;font-size:10px">${list.length} results</span>`:''}</div>
  ${q?`<div class="filter-bar"><select class="select" id="type-filter"><option value="all" ${state.exploreType==='all'?'selected':''}>All</option><option value="manga" ${state.exploreType==='manga'?'selected':''}>Manga</option><option value="manhwa" ${state.exploreType==='manhwa'?'selected':''}>Manhwa</option><option value="manhua" ${state.exploreType==='manhua'?'selected':''}>Manhua</option></select><select class="select" id="sort-filter"><option value="popular" ${state.exploreSort==='popular'?'selected':''}>Popular</option><option value="rating" ${state.exploreSort==='rating'?'selected':''}>Top rated</option></select></div>`:''}
  ${state.searching?`<div class="empty" style="margin-top:14px"><h3>Searching connected sources…</h3></div>`
   :state.searchError?`<div class="empty" style="margin-top:14px"><h3>Search failed</h3><p>${escapeXml(state.searchError)}</p><button class="btn btn-ghost" data-action="retry-search">${ICONS.refresh} Retry</button></div>`
   :q&&list.length===0?`<div class="empty" style="margin-top:14px"><h3>No results</h3><p>Nothing matched "${escapeXml(q)}".</p></div>`
   :q?`<div class="cover-grid" style="margin-top:14px">${list.map(t=>card(t)).join('')}</div>`
   :`<div class="empty" style="margin-top:14px"><h3>Type a title above and press Enter</h3></div>`}
  </section></div>`;
}

function library(){
  if(!state.auth?.user) return signInPrompt('Library', 'Sign in to build a library that syncs across devices.');
  if(!state.library.loaded){ setTimeout(hydrateAll,0); return `<div class="page-enter"><div class="empty"><h3>Loading your library…</h3></div></div>`; }
  const items=state.library.items;
  const grouped={reading:[],completed:[],'on-hold':[],'plan-to-read':[],dropped:[]};
  for(const it of items) (grouped[it.status]||grouped.reading).push(it);
  const asCard=it=>card({id:it.title_id,title:it.title,cover:it.cover_url,type:it.type,readable:true},{showProgress:true});
  return `<div class="page-enter"><div class="section-head" style="margin-top:10px"><div><div class="section-title">Library</div><div style="color:#707783;font-size:11px;margin-top:4px">${items.length} titles</div></div></div>
  <section class="section"><div class="library-overview"><div class="overview-card"><h3>Library Overview</h3><div class="stat-grid"><div class="stat"><div class="stat-value">${grouped.reading.length}</div><div class="stat-label">Reading</div></div><div class="stat"><div class="stat-value">${grouped.completed.length}</div><div class="stat-label">Completed</div></div><div class="stat"><div class="stat-value">${grouped['on-hold'].length}</div><div class="stat-label">On hold</div></div><div class="stat"><div class="stat-value">${grouped['plan-to-read'].length}</div><div class="stat-label">Plan to read</div></div><div class="stat"><div class="stat-value">${grouped.dropped.length}</div><div class="stat-label">Dropped</div></div></div></div></div></section>
  <section class="section"><div class="section-head"><div class="section-title">All titles</div></div>${items.length?`<div class="cover-grid">${items.map(asCard).join('')}</div>`:`<div class="empty"><h3>Your library is empty</h3><p>Add titles from their detail page.</p></div>`}</section></div>`;
}
function signInPrompt(title, sub){
  return `<div class="page-enter"><div class="section-head" style="margin-top:10px"><div class="section-title">${escapeXml(title)}</div></div><div class="empty"><h3>Sign in required</h3><p>${escapeXml(sub)}</p><button class="btn btn-primary" data-action="open-login">Sign in / Create account</button></div></div>`;
}

function simpleList(kind){
  if(!state.auth?.user) return signInPrompt(kind==='bookmarks'?'Bookmarks':kind==='updates'?'Updates':'History', 'Sign in to sync this across devices.');
  const src = kind==='bookmarks'?state.bookmarks : kind==='updates'?state.updates : state.history;
  if(!src.loaded){ setTimeout(hydrateAll,0); return `<div class="page-enter"><div class="empty"><h3>Loading…</h3></div></div>`; }
  const title = kind==='bookmarks'?'Bookmarks':kind==='updates'?'Updates':'History';
  const sub = kind==='bookmarks'?'Saved series you want one tap away.':kind==='updates'?'Library titles with chapters you haven\'t seen yet.':'Everything you\'ve recently opened.';
  const items=src.items;
  const asCard=it=>card({id:it.title_id,title:it.title,cover:it.cover_url,type:it.type,readable:true},{showProgress:kind!=='bookmarks'});
  return `<div class="page-enter"><div class="section-head" style="margin-top:10px"><div><div class="section-title">${title}</div><div style="color:#707783;font-size:11px;margin-top:4px">${escapeXml(sub)}</div></div></div><section class="section">${items.length?`<div class="cover-grid">${items.map(asCard).join('')}</div>`:`<div class="empty"><h3>Nothing here yet</h3></div>`}</section></div>`;
}

async function titleDetail(id){
  const t = await ensureTitle(id);
  if(t==='not-found') return notFoundView('Title Not Found', "This title doesn't exist, or hasn't been discovered by BUFU yet — try searching for it first.");
  if(t==='error') return errorView('Couldn\'t load this title', 'retry-title', id);
  const p=getProgress(t.id);
  const saved=libraryStatus(t.id)!==null;
  const bookmarked=isBookmarked(t.id);
  const chapters = await ensureChapters(id);
  const chapterMarkup = chapters==='error'
    ? `<div class="empty"><h3>Couldn't load chapters</h3><button class="btn btn-ghost" data-action="retry-chapters" data-title-id="${escapeXml(id)}">${ICONS.refresh} Retry</button></div>`
    : chapters.length===0
      ? `<div class="empty"><h3>${t.readable?'No chapters found':'Not readable through a connected source'}</h3><p>${t.readable?'MangaDex has this title but no matching chapters were found.':'This title was discovered through metadata only — no legitimate reader source is mapped to it yet.'}</p></div>`
      : chapters.map(c=>`<div class="chapter-row"><div class="chapter-main"><strong>Chapter ${c.number===null?'—':escapeXml(String(c.number))}${c.label?` — ${escapeXml(c.label)}`:''}</strong><span>${c.publishedAt?new Date(c.publishedAt).toLocaleDateString():'—'} · ${c.pagesCount||'—'} pages</span></div><button class="chapter-action ${p?.chapterId===c.id?'primary':''}" data-action="open-chapter" data-title-id="${escapeXml(t.id)}" data-chapter-id="${escapeXml(c.id)}">${p?.chapterId===c.id?'Continue':'Read'}</button></div>`).join('');
  const cover=safeImgSrc(t.cover);
  return `<div class="page-enter"><div class="detail"><div class="detail-cover"><img src="${cover}" alt="${escapeXml(t.title)}" onerror="this.onerror=null;this.src='${placeholderCover(t.title)}'"></div><div class="detail-copy"><div class="eyebrow"><span class="pulse"></span>${escapeXml(t.type||'unknown')} · ${escapeXml(t.status||'unknown')}</div><h1>${escapeXml(t.title)}</h1><div class="subtitles">${escapeXml(t.author||'Unknown author')}${t.artist?` · ${escapeXml(t.artist)}`:''}</div><div class="rating"><strong>${t.score?escapeXml(String(t.score)):'—'}</strong>${t.popularity?`<span style="color:#6f7682;font-size:10px">${fmt(t.popularity)} readers</span>`:''}</div><div class="chips">${(t.genres||[]).map(g=>`<span class="chip">${escapeXml(g)}</span>`).join('')}</div><p>${escapeXml(t.description||'No description available.')}</p><div class="detail-actions">${t.readable?`<button class="btn btn-primary" data-action="read-title" data-title-id="${escapeXml(t.id)}">${ICONS.play} ${p?'Continue':'Start reading'}</button>`:`<button class="btn btn-ghost" disabled title="No legitimate reader source connected yet">Not readable yet</button>`}<button class="btn btn-ghost" data-action="toggle-library" data-title-id="${escapeXml(t.id)}" data-in-library="${saved}">${ICONS.bookmark} ${saved?'In Library':'Add to Library'}</button><button class="btn btn-ghost" data-action="bookmark" data-title-id="${escapeXml(t.id)}" data-bookmarked="${bookmarked}">${bookmarked?'Bookmarked':'Bookmark'}</button></div><div class="meta-grid"><div class="meta-box"><div class="meta-label">Format</div><div class="meta-value">${escapeXml(t.type||'—')}</div></div><div class="meta-box"><div class="meta-label">Chapters</div><div class="meta-value">${Array.isArray(chapters)?chapters.length:'—'}</div></div><div class="meta-box"><div class="meta-label">Sources</div><div class="meta-value">${(t.sources||[]).length} connected</div></div><div class="meta-box"><div class="meta-label">Reading mode</div><div class="meta-value">${t.readingMode==='vertical'?'Continuous':t.readingMode==='page'?'Page':'Auto'}</div></div></div></div></div><section class="section"><div class="section-head"><div class="section-title">Chapters</div><span style="color:#676e79;font-size:10px">Newest first</span></div><div class="chapter-list">${chapterMarkup}</div></section></div>`;
}
function notFoundView(title, sub){
  return `<div class="page-enter"><div class="not-found"><h2>${escapeXml(title)}</h2><p>${escapeXml(sub)}</p><button class="btn btn-primary" data-nav="/explore">Back to Explore</button></div></div>`;
}
function errorView(title, retryAction, id){
  return `<div class="page-enter"><div class="not-found"><h2>${escapeXml(title)}</h2><p>Something went wrong reaching BUFU's backend.</p><button class="btn btn-ghost" data-action="${retryAction}" data-title-id="${escapeXml(id)}">${ICONS.refresh} Retry</button></div></div>`;
}

// ── Reader ──────────────────────────────────────────────────────────
// Manga: page-by-page, prev/next, keyboard, tap zones, page counter, resume
// by page index, auto-next at chapter end. Manhwa: continuous vertical,
// lazy-loaded images, scroll-ratio progress that restores reliably by
// waiting for images to settle and then scrolling the anchor page into
// view (not a single scrollTop=scrollHeight*ratio guess against a height
// that lazy images are still changing).
let readerCleanup=null;
async function reader(titleId, rawChapterId){
  if(readerCleanup){ readerCleanup(); readerCleanup=null; }
  const t = await ensureTitle(titleId);
  if(t==='not-found') return notFoundView('Title Not Found', "This title doesn't exist.");
  if(t==='error') return errorView('Couldn\'t load this title', 'retry-title', titleId);

  let chapterId = rawChapterId;
  if(chapterId==='latest'){
    const chapters = await ensureChapters(titleId);
    if(chapters==='error') return errorView('Couldn\'t load chapters', 'retry-chapters', titleId);
    if(!chapters.length) return notFoundView('No Chapters Available', 'This title has no chapters through a connected source yet.');
    chapterId = pickLatestChapter(chapters).id;
    location.replace('#/read/'+titleId+'/'+chapterId); // resolve latest -> real id in the URL, don't leave "latest" in history
    return `<div class="reader-shell"></div>`;
  }
  const chapters = await ensureChapters(titleId);
  if(chapters==='error') return errorView('Couldn\'t load chapters', 'retry-chapters', titleId);
  const chapter = chapters.find(c=>c.id===chapterId);
  if(!chapter) return notFoundView('Chapter Not Found', 'This chapter link is invalid or no longer exists — BUFU never silently substitutes a different chapter.');

  const key=`${titleId}|${chapterId}`;
  let pages = state.pagesCache.get(key);
  if(pages===undefined){
    pages='loading';
    setTimeout(async ()=>{ await fetchPages(titleId, chapterId); if(currentPath()===`/read/${titleId}/${chapterId}`) render(); },0);
  }
  const mode = state.readerMode==='auto' ? (t.readingMode==='vertical'?'vertical':'page') : state.readerMode;

  setTimeout(()=>wireReader(t, chapter, mode, state.pagesCache.get(key)),0);
  recordHistory(titleId, chapterId);

  const stack = pages==='loading'
    ? `<div class="empty" style="margin:60px auto;max-width:420px"><h3>Loading pages…</h3><p>Trying the connected reader source.</p></div>`
    : pages==='error' || (Array.isArray(pages)&&pages.length===0)
      ? `<div class="empty" style="margin:60px auto;max-width:420px"><h3>No source available</h3><p>The connected source couldn't serve this chapter right now.</p><button class="btn btn-ghost" data-action="retry-pages" data-title-id="${escapeXml(titleId)}" data-chapter-id="${escapeXml(chapterId)}">${ICONS.refresh} Retry</button></div>`
      : mode==='vertical'
        ? pages.map((p,i)=>`<div class="reader-page-wrap" data-index="${i}"><img class="reader-page" data-index="${i}" src="${safeImgSrc(p.src)}" alt="${escapeXml(p.alt||`Page ${i+1}`)}" loading="${i<2?'eager':'lazy'}" data-retry-src="${safeImgSrc(p.src)}"></div>`).join('')
        : `<img class="reader-page page-centered" data-index="0" src="${safeImgSrc(pages[0].src)}" alt="${escapeXml(pages[0].alt||'Page 1')}" data-retry-src="${safeImgSrc(pages[0].src)}">`;

  return `<div class="reader-shell"><div class="reader-top"><button class="reader-btn" data-action="close-reader" data-title-id="${escapeXml(titleId)}" aria-label="Back">${ICONS.back}</button><div class="reader-title"><strong>${escapeXml(t.title)}</strong><span>Chapter ${chapter.number===null?'—':escapeXml(String(chapter.number))} · ${mode==='vertical'?'Continuous':'Page mode'}</span></div><div class="reader-spacer"></div><button class="reader-btn" data-action="toggle-reader-mode">${mode==='vertical'?'▤':'▥'}</button><button class="reader-btn" data-action="fullscreen">${ICONS.fullscreen}</button></div><main class="reader-main" id="reader-main"><div class="reader-stack" id="reader-stack">${stack}</div></main><div class="reader-controls"><button class="reader-chip" data-action="reader-prev">Prev</button><span id="reader-page-indicator" style="color:#9aa0ab;font-size:10px"></span><button class="reader-chip" data-action="reader-next">Next</button></div><div class="reader-progress"><span id="reader-progress-bar"></span></div></div>`;
}

function wireReader(t, chapter, mode, pages){
  const main=$('#reader-main'); const bar=$('#reader-progress-bar'); const indicator=$('#reader-page-indicator');
  if(!main || !Array.isArray(pages) || !pages.length) return;

  // Image retry: any page image that fails to load gets a click-to-retry
  // tile instead of a broken image or a crashed reader; retrying re-sets
  // src (with a cache-busting param) without touching reading position.
  $$('.reader-page', main).forEach(img=>{
    img.addEventListener('error', function onErr(){
      if(this.dataset.failed) return;
      this.dataset.failed='1';
      const wrap=this.closest('.reader-page-wrap')||this;
      const retryTile=document.createElement('button');
      retryTile.className='retry-tile';
      retryTile.style.aspectRatio = '2/3';
      retryTile.innerHTML=`${ICONS.refresh}<span>Page ${Number(this.dataset.index)+1} failed to load — tap to retry</span>`;
      retryTile.addEventListener('click',()=>{
        const freshUrl = this.dataset.retrySrc + (this.dataset.retrySrc.includes('?')?'&':'?') + 'retry=' + Date.now();
        this.src = freshUrl;
        this.dataset.failed='';
        retryTile.replaceWith(this);
      });
      this.replaceWith(retryTile);
    });
  });

  const existing = getProgress(t.id);
  const resumeIndex = (existing && existing.chapterId===chapter.id) ? Math.max(0, Math.min(pages.length-1, existing.pageIndex||0)) : 0;
  let index = resumeIndex;

  function updateIndicator(i){ if(indicator) indicator.textContent = `${i+1} / ${pages.length}`; }
  updateIndicator(index);

  if(mode==='page'){
    renderPageMode(index);
    const onKey=(e)=>{
      if(e.key==='Escape'){ nav('/title/'+t.id); return; }
      if(e.key==='ArrowRight'||e.key==='ArrowDown'){ goTo(index+1); }
      if(e.key==='ArrowLeft'||e.key==='ArrowUp'){ goTo(index-1); }
    };
    const onClick=(e)=>{
      const rect=main.getBoundingClientRect();
      const x=e.clientX-rect.left;
      if(x > rect.width*0.6) goTo(index+1); else if(x < rect.width*0.4) goTo(index-1);
    };
    window.addEventListener('keydown', onKey);
    main.addEventListener('click', onClick);
    readerCleanup=()=>{ window.removeEventListener('keydown', onKey); main.removeEventListener('click', onClick); };
    function goTo(i){
      if(i<0) return;
      if(i>=pages.length){ autoNextChapter(t.id, chapter.id); return; }
      index=i; renderPageMode(index);
    }
    function renderPageMode(i){
      const img=$('.reader-page', main);
      if(img){ img.src=safeImgSrc(pages[i].src); img.dataset.index=i; img.dataset.retrySrc=safeImgSrc(pages[i].src); img.alt=pages[i].alt||`Page ${i+1}`; }
      updateIndicator(i);
      const pct=Math.round(((i+1)/pages.length)*100);
      if(bar) bar.style.width=`${pct}%`;
      setProgress(t.id, chapter.id, chapter.number, i, (i+1)/pages.length, i===pages.length-1);
    }
  } else {
    // Vertical (manhwa) mode: track the current page via IntersectionObserver
    // (the most-visible page IS the reading position — far more reliable
    // under lazy-loaded, height-changing images than a raw scrollTop math).
    // Restoration waits for images up to the resume target to load (or a
    // bounded timeout), then scrollIntoView()s that page, with one
    // correction pass shortly after to absorb any late layout shift from
    // images that were still loading.
    const wraps = $$('.reader-page-wrap', main);
    let currentIndex = resumeIndex;
    const io = new IntersectionObserver((entries)=>{
      let best=null, bestRatio=0;
      for(const e of entries){ if(e.isIntersecting && e.intersectionRatio>bestRatio){ bestRatio=e.intersectionRatio; best=e.target; } }
      if(best){
        currentIndex = Number(best.dataset.index);
        updateIndicator(currentIndex);
        const ratio = main.scrollTop / Math.max(1, main.scrollHeight - main.clientHeight);
        if(bar) bar.style.width = `${Math.round(Math.max(0,Math.min(1,ratio))*100)}%`;
        setProgress(t.id, chapter.id, chapter.number, currentIndex, Math.max(0,Math.min(1,ratio)), currentIndex===pages.length-1);
      }
    }, {root: main, threshold: [0.25,0.5,0.75]});
    wraps.forEach(w=>io.observe(w));

    const onEndCheck=()=>{
      const ratio = main.scrollTop / Math.max(1, main.scrollHeight - main.clientHeight);
      if(ratio > 0.985) autoNextChapter(t.id, chapter.id, true);
    };
    main.addEventListener('scroll', onEndCheck);
    readerCleanup=()=>{ io.disconnect(); main.removeEventListener('scroll', onEndCheck); };

    if(resumeIndex>0){
      const target = wraps[resumeIndex];
      const imagesToWaitFor = wraps.slice(0, resumeIndex+1).map(w=>$('img',w)).filter(Boolean);
      const settle = () => target?.scrollIntoView({block:'start'});
      Promise.race([
        Promise.all(imagesToWaitFor.map(img=>img.complete?Promise.resolve():new Promise(res=>{img.addEventListener('load',res,{once:true});img.addEventListener('error',res,{once:true});}))),
        new Promise(res=>setTimeout(res,2500)),
      ]).then(()=>{
        settle();
        // Correction pass: images below the fold can still shift layout
        // after the first scroll; re-settle once more shortly after.
        setTimeout(settle, 350);
      });
    }
  }

  function autoNextChapter(titleId, chapterId, fromScroll){
    if(fromScroll && window.__bufuAutoNextArmed===chapterId) return; // don't fire repeatedly while sitting at the bottom
    window.__bufuAutoNextArmed=chapterId;
    const idx = (state.chaptersCache.get(titleId)||[]).findIndex(c=>c.id===chapterId);
    const list = state.chaptersCache.get(titleId)||[];
    const next = idx>0 ? list[idx-1] : null; // list is newest-first, so the next chapter is the previous array entry
    if(next) nav(`/read/${titleId}/${next.id}`);
  }
}

// ── Auth modal ──────────────────────────────────────────────────────
function authModal(mode='login'){
  return `<div class="modal-overlay" data-action="close-modal"><div class="modal-card" onclick="event.stopPropagation()">
    <div class="modal-head"><h3>${mode==='login'?'Sign in to BUFU':'Create your BUFU account'}</h3><button class="modal-close" data-action="close-modal" aria-label="Close">✕</button></div>
    <form id="auth-form">
      ${mode==='register'?'<label>Display name<input name="displayName" type="text" maxlength="60" placeholder="Reader"></label>':''}
      <label>Email<input name="email" type="email" required placeholder="you@example.com" autocomplete="email"></label>
      <label>Password<input name="password" type="password" required minlength="8" placeholder="At least 8 characters" autocomplete="${mode==='login'?'current-password':'new-password'}"></label>
      <div id="auth-error" class="auth-error" hidden></div>
      <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">${mode==='login'?'Sign in':'Create account'}</button>
    </form>
    <div class="modal-switch">${mode==='login'?`New to BUFU? <button type="button" data-action="switch-auth" data-mode="register">Create an account</button>`:`Already have an account? <button type="button" data-action="switch-auth" data-mode="login">Sign in</button>`}</div>
  </div></div>`;
}
function renderModal(){
  const root=document.getElementById('modal-root'); if(!root) return;
  root.innerHTML = state.modal ? authModal(state.modal) : '';
  if(state.modal){
    $('#auth-form')?.addEventListener('submit', onAuthSubmit);
    $$('[data-action="close-modal"]').forEach(el=>el.addEventListener('click',()=>{state.modal=null;renderModal();}));
    $$('[data-action="switch-auth"]').forEach(el=>el.addEventListener('click',()=>{state.modal=el.dataset.mode;renderModal();}));
  }
}
async function onAuthSubmit(e){
  e.preventDefault();
  const mode=state.modal; const fd=new FormData(e.target);
  const email=fd.get('email'), password=fd.get('password'), displayName=fd.get('displayName');
  const errBox=$('#auth-error'); if(errBox) errBox.hidden=true;
  try{
    if(mode==='register') await doRegister(email,password,displayName); else await doLogin(email,password);
    state.modal=null; renderModal();
    toast(mode==='register'?'Account created':'Welcome back');
    render();
  }catch(err){
    if(errBox){ errBox.textContent = err.message || 'Something went wrong'; errBox.hidden=false; }
  }
}

function settings(){
  return `<div class="page-enter"><div class="section-head" style="margin-top:10px"><div><div class="section-title">Settings</div><div style="color:#707783;font-size:11px;margin-top:4px">Tune BUFU to the way you read.</div></div></div>
  <section class="section"><div class="overview-card"><h3>Account</h3>${state.auth?.user?`<p style="margin:0 0 12px;color:#8c939e;font-size:11px">Signed in as <strong>${escapeXml(state.auth.user.email)}</strong>. Library, bookmarks, history and progress sync to this account.</p><button class="btn btn-ghost" data-action="logout">Sign out</button>`:`<p style="margin:0 0 12px;color:#8c939e;font-size:11px">Sign in to sync your library, bookmarks, history and reading progress across devices.</p><button class="btn btn-primary" data-action="open-login">Sign in / Create account</button>`}</div></section>
  <section class="section"><div class="overview-card"><h3>Theme</h3><div class="chip-select">${['light','dark','system'].map(m=>`<button data-action="set-theme" data-mode="${m}" class="${state.theme===m?'active':''}">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}</div></div></section>
  <section class="section"><div class="overview-card"><h3>Reader mode</h3><p style="margin:0 0 10px;color:#8c939e;font-size:11px">Auto picks page mode for manga and continuous mode for manhwa/manhua, from each title's verified original language — you can override per session.</p><div class="chip-select">${['auto','page','vertical'].map(m=>`<button data-action="set-reader-mode" data-mode="${m}" class="${state.readerMode===m?'active':''}">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}</div></div></section>
  <section class="section"><div class="overview-card"><h3>Source engine</h3><p style="margin:0;color:#8c939e;font-size:11px;line-height:1.6">MangaDex is BUFU's only reader-capable source right now. AniList, Jikan, Kitsu, MangaUpdates and SHIRO contribute metadata and discovery — a title found only through them shows as metadata until a legitimate reader source is mapped to it.</p></div></section></div>`;
}

function render(){
  const path=currentPath();
  const readMatch=path.match(/^\/read\/([^/]+)\/([^/]+)$/);
  const run = async () => {
    let content='', active='/';
    if(readMatch){
      content = await reader(decodeURIComponent(readMatch[1]), decodeURIComponent(readMatch[2]));
      $('#app').innerHTML = content; bind(); return;
    }
    if(path==='/') { content=home(); active='/'; }
    else if(path.startsWith('/explore')){ content=explore(); active='/explore'; }
    else if(path.startsWith('/library')){ content=library(); active='/library'; }
    else if(path.startsWith('/history')){ content=simpleList('history'); active='/history'; }
    else if(path.startsWith('/bookmarks')){ content=simpleList('bookmarks'); active='/bookmarks'; }
    else if(path.startsWith('/updates')){ content=simpleList('updates'); active='/updates'; }
    else if(path.startsWith('/settings')){ content=settings(); active='/settings'; }
    else if(path.startsWith('/title/')){ if(readerCleanup){readerCleanup();readerCleanup=null;} content = await titleDetail(decodeURIComponent(path.split('/')[2])); active=''; }
    else { content=home(); active='/'; }
    $('#app').innerHTML=`<div class="app-shell">${sidebar(active)}<main class="main">${topbar()}<div class="container">${content}</div></main>${mobileNav(active)}</div>`;
    bind();
  };
  run();
}

function bind(){
  applyTheme();
  $$('.card').forEach(el=>el.addEventListener('click',(e)=>{if(e.target.closest('[data-action="bookmark"]'))return;nav('/title/'+el.dataset.titleId)}));
  $$('[data-nav]').forEach(el=>el.addEventListener('click',()=>nav(el.dataset.nav)));
  $$('[data-action]').forEach(el=>el.addEventListener('click',handleAction));
  const search=$('#global-search');
  if(search){ search.addEventListener('keydown',e=>{ if(e.key==='Enter'){ state.search=search.value; nav('/explore'); runSearch(search.value); } }); }
  const tf=$('#type-filter'); if(tf)tf.addEventListener('change',()=>{state.exploreType=tf.value;render()});
  const sf=$('#sort-filter'); if(sf)sf.addEventListener('change',()=>{state.exploreSort=sf.value;render()});
}
function handleAction(e){
  const a=e.currentTarget.dataset.action;
  if(a==='profile'){ if(state.auth?.user){ if(confirm(`Signed in as ${state.auth.user.email}. Sign out?`)) doLogout(); } else { state.modal='login'; renderModal(); } }
  if(a==='open-login'){ state.modal='login'; renderModal(); }
  if(a==='logout'){ doLogout(); }
  if(a==='set-theme'){ state.theme=e.currentTarget.dataset.mode; try{localStorage.setItem('bufu_theme',state.theme)}catch{}; applyTheme(); render(); }
  if(a==='set-reader-mode'){ state.readerMode=e.currentTarget.dataset.mode; try{localStorage.setItem('bufu_reader_mode',state.readerMode)}catch{}; render(); toast('Reader mode saved'); }
  if(a==='bookmark'){ e.stopPropagation(); const id=e.currentTarget.dataset.titleId; toggleBookmark(id, e.currentTarget.dataset.bookmarked==='true'); }
  if(a==='toggle-library'){ const id=e.currentTarget.dataset.titleId; toggleLibrary(id, e.currentTarget.dataset.inLibrary!=='true'); }
  if(a==='read-title'){ const id=e.currentTarget.dataset.titleId; const p=getProgress(id); nav(`/read/${id}/${p?.chapterId || 'latest'}`); }
  if(a==='open-chapter'){ nav(`/read/${e.currentTarget.dataset.titleId}/${e.currentTarget.dataset.chapterId}`); }
  if(a==='close-reader'){ nav('/title/'+e.currentTarget.dataset.titleId); }
  if(a==='fullscreen'){ document.documentElement.requestFullscreen?.(); }
  if(a==='toggle-reader-mode'){ state.readerMode = state.readerMode==='vertical' ? 'page' : 'vertical'; render(); }
  if(a==='reader-prev'){ const main=$('#reader-main'); if(main){ const wraps=$$('.reader-page-wrap',main); if(wraps.length){ const cur=Number($('.reader-page',main)?.dataset.index||0); wraps[Math.max(0,cur-1)]?.scrollIntoView({block:'start'});} else { window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft'})); } } }
  if(a==='reader-next'){ const main=$('#reader-main'); if(main){ const wraps=$$('.reader-page-wrap',main); if(wraps.length){ const cur=Number($('.reader-page',main)?.dataset.index||0); wraps[Math.min(wraps.length-1,cur+1)]?.scrollIntoView({block:'start'});} else { window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'})); } } }
  if(a==='retry-home'){ state.home={loaded:false,loading:false,items:[],error:null}; render(); }
  if(a==='retry-search'){ runSearch(state.search); }
  if(a==='retry-title'){ state.titleCache.delete(e.currentTarget.dataset.titleId); render(); }
  if(a==='retry-chapters'){ state.chaptersCache.delete(e.currentTarget.dataset.titleId); render(); }
  if(a==='retry-pages'){ state.pagesCache.delete(`${e.currentTarget.dataset.titleId}|${e.currentTarget.dataset.chapterId}`); render(); }
}
window.addEventListener('hashchange',render);
applyTheme();
render();
restoreSession();

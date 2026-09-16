const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => [...p.querySelectorAll(s)];

// ── CSP-safe image fallbacks ───────────────────────────────────────────
// The CSP's script-src is 'self' only (no 'unsafe-inline'), so inline
// onerror="..." attributes are silently dropped by the browser and never
// run — a broken cover URL would just render as a broken-image icon
// forever. Every fallback-capable <img> instead carries a data-fallback
// (swap src once) or data-fallback-hide (hide the element once) attribute,
// and this single capture-phase listener — 'error' doesn't bubble, so
// delegation must use the capture phase on a static ancestor — handles all
// of them for the lifetime of the app, including images inserted by future
// innerHTML re-renders.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.fallbackApplied) return; // never loop if the fallback itself 404s
  if (img.dataset.fallback) {
    img.dataset.fallbackApplied = '1';
    img.src = img.dataset.fallback;
  } else if (img.dataset.fallbackHide !== undefined) {
    img.dataset.fallbackApplied = '1';
    img.style.display = 'none';
  }
}, true);

// ── Icons ───────────────────────────────────────────────────────────
// Stitch's design system draws its icon language from Google's Material
// Symbols (variable-weight outline glyphs, filled on "active" states).
// mi() renders one inline; MI maps BUFU's existing semantic icon keys to
// the Material Symbols glyph name so every call site elsewhere in this
// file (ICONS.play, ICONS.refresh, etc.) keeps working unchanged.
const MI = {
  home:'home', explore:'explore', library:'local_library', updates:'new_releases',
  history:'history', bookmark:'bookmark', settings:'settings', search:'search',
  play:'play_arrow', back:'arrow_back', fullscreen:'fullscreen', refresh:'refresh',
  close:'close', chevronRight:'chevron_right', chevronLeft:'chevron_left',
  logout:'logout', pageMode:'auto_stories', verticalMode:'view_agenda', star:'star',
};
function mi(name, cls='', filled=false){
  return `<span class="material-symbols-outlined align-middle${cls?` ${cls}`:''}"${filled?` style="font-variation-settings:'FILL' 1"`:''}>${MI[name]||name}</span>`;
}
const ICONS = new Proxy({}, { get: (_, key) => mi(key) });

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
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 820"><rect width="600" height="820" fill="#f0eded"/><text x="42" y="753" fill="#a73a15" fill-opacity=".85" font-family="Arial, sans-serif" font-size="34" font-weight="800">${escapeXml(words)}</text></svg>`;
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
  const timeout=setTimeout(()=>controller.abort(),20000);
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
  homeGenre: 'all',
  detailTab: 'overview',
  detailTabTitleId: null,
  remoteSearch: [],
  searching: false,
  searchError: null,
  home: {loaded:false, loading:false, items:[], error:null, genre:'all'},
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
let pendingProgressSync=null;
function syncProgressToServer(titleId, chapterId, chapterNumber, pageIndex, scrollRatio, completed, clientUpdatedAt){
  if(!state.auth?.token) return;
  pendingProgressSync={titleId, chapterId, chapterNumber, pageIndex, scrollRatio, completed, clientUpdatedAt};
  clearTimeout(progressSyncTimer);
  progressSyncTimer=setTimeout(()=>flushProgressSync(false), 900);
}
// Sends whatever progress is still debounced, right now, instead of waiting
// out the 900ms window. Without this, closing the reader, switching
// chapters, or backgrounding/closing the tab right after a page turn could
// let the debounce timer get cut off before it ever fires — the server
// would keep stale progress even though setProgress() already ran. Called
// on every "the user is about to leave this progress behind" moment below;
// keepalive=true lets the request survive past pagehide/visibilitychange,
// when the page may be torn down before a normal fetch would complete.
function flushProgressSync(keepalive){
  clearTimeout(progressSyncTimer);
  if(!pendingProgressSync || !state.auth?.token) return;
  const p=pendingProgressSync; pendingProgressSync=null;
  apiFetch('/api/me/progress',{method:'PUT',body:JSON.stringify(p),keepalive:!!keepalive}).catch(()=>{});
}
window.addEventListener('pagehide', ()=>flushProgressSync(true));
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flushProgressSync(true); });
function setProgress(titleId, chapterId, chapterNumber, pageIndex, scrollRatio, completed){
  const updatedAt=new Date().toISOString();
  state.progress.set(titleId, {chapterId, chapterNumber, pageIndex, scrollRatio, completed, updatedAt});
  persistProgressLocally();
  // Same timestamp captured here (the moment this progress actually
  // happened) travels to the server as clientUpdatedAt, so a slow/delayed
  // sync from this device can never overwrite a newer write that already
  // landed from another device — see the server-side guard in index.ts.
  syncProgressToServer(titleId, chapterId, chapterNumber, pageIndex, scrollRatio, completed, updatedAt);
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
  if(state.home.loading) return;

  const genre = state.homeGenre;
  state.home.loading = true;

  if(currentPath()==='/' || currentPath()===''){
    render();
  }

  const r = await apiFetch(`/api/home${genre&&genre!=='all'?`?genre=${encodeURIComponent(genre)}`:''}`);

  if(r.ok){
    state.home = {
      loaded: true,
      loading: false,
      items: r.data.results || [],
      error: null,
      genre,
    };
  }else{
    state.home = {
      loaded: true,
      loading: false,
      items: [],
      error: r.error,
      genre,
    };
  }

  if(currentPath()==='/' || currentPath()===''){
    render();
  }

  if(typeof finishSplash === 'function'){
    finishSplash();
  }
}
// Guards against out-of-order responses: if the user fires a second search
// (edits the query and hits Enter again, or taps Retry) before the first
// request's response lands, the first request's eventual result must never
// clobber the second, newer query's result just because its network round
// trip happened to finish later.
let searchGen = 0;
async function runSearch(q){
  if(!q.trim()) return;
  const myGen = ++searchGen;
  state.searching=true; state.searchError=null; render();
  const r=await apiFetch('/api/search?q='+encodeURIComponent(q));
  if(myGen !== searchGen) return; // a newer search superseded this one — drop it
  state.searching=false;
  if(r.ok){ state.remoteSearch=r.data.results||[]; state.searchError=null; }
  else { state.remoteSearch=[]; state.searchError=r.error; }
  render();
}

function card(t,{showProgress=true}={}){
  const p=getProgress(t.id);
  const hasUpdate=state.updates.items.some(u=>u.title_id===t.id);
  const bookmarked=isBookmarked(t.id);
  const cover=safeImgSrc(t.cover);
  const badge = hasUpdate ? `<span class="bg-primary text-white text-[10px] font-bold px-2 py-1 rounded-full w-max mb-2">NEW</span>`
    : !t.readable ? `<span class="bg-on-surface/70 text-white text-[10px] font-bold px-2 py-1 rounded-full w-max mb-2">METADATA</span>` : '';
  return `<article class="card group cursor-pointer flex flex-col h-full" data-title-id="${escapeXml(t.id)}">
    <div class="relative rounded-2xl overflow-hidden shadow-[0px_4px_20px_rgba(0,0,0,0.06)] mb-3 bg-surface-container" style="aspect-ratio:3/4">
      <img class="cover-art w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" src="${cover}" alt="${escapeXml(t.title)} cover" loading="lazy" data-fallback="${placeholderCover(t.title)}">
      <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent flex flex-col justify-end p-3">${badge}</div>
      <button class="card-more absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity" data-action="bookmark" data-title-id="${escapeXml(t.id)}" data-bookmarked="${bookmarked}" aria-label="Bookmark">${mi('bookmark', 'text-[16px]', bookmarked)}</button>
    </div>
    <h3 class="card-title font-title-md text-[14px] leading-tight font-semibold text-on-background group-hover:text-primary transition-colors line-clamp-1">${escapeXml(t.title)}</h3>
    <div class="card-meta flex items-center justify-between mt-1">
      <p class="font-body-sm text-[12px] text-on-surface-variant">${p?`Ch. ${escapeXml(String(p.chapterNumber??'—'))}`:escapeXml(t.type||'—')}</p>
      ${t.score?`<span class="font-label-bold text-[11px] flex items-center gap-1">${mi('star','text-[13px] text-primary',true)}${escapeXml(String(t.score))}</span>`:''}
    </div>
    ${showProgress&&p?`<div class="card-progress h-1.5 rounded-full bg-surface-container-high mt-2 overflow-hidden"><span class="block h-full bg-primary rounded-full" style="width:${progressPercent(p)}%"></span></div>`:''}
  </article>`;
}
function progressPercent(p){
  if(!p) return 0;
  if(p.scrollRatio) return Math.max(0,Math.min(100,Math.round(p.scrollRatio*100)));
  return p.completed ? 100 : 30;
}

function sidebar(active){
  const items=[['home','Home','/'],['explore','Explore','/explore'],['library','Library','/library'],['updates','Updates','/updates'],['history','History','/history'],['bookmark','Bookmarks','/bookmarks']];
  const updatesCount=state.updates.items.length;
  const welcomeName = state.auth?.user ? (state.auth.user.displayName||state.auth.user.email||'Reader') : 'Guest reader';
  return `<aside class="sidebar hidden lg:flex flex-col gap-2 py-4 bg-surface-container-low border-r border-outline-variant/40 h-screen w-[240px] shrink-0 sticky top-0 overflow-y-auto">
    <a class="brand flex items-center gap-3 px-6 py-4" href="#/" aria-label="BUFU">
      <img class="w-10 h-10 rounded-xl object-cover shadow-sm" src="./assets/bufu-mark.png" alt="BUFU logo">
      <div><h1 class="font-headline-lg text-[20px] font-bold text-primary tracking-tight leading-none">BUFU</h1><p class="font-label-bold text-[10px] text-on-surface-variant mt-1">Read beyond worlds</p></div>
    </a>
    <nav class="nav flex-1 flex flex-col gap-1 px-3 mt-2">${items.map(([icon,label,path])=>`<a class="nav-item flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active===path?'active bg-primary-container text-on-primary-container font-bold':'text-on-surface-variant hover:bg-surface-container-high'}" href="#${path}">${mi(icon,'text-[20px]',active===path)}<span class="nav-label font-title-md text-[14px]">${label}</span>${icon==='updates'&&updatesCount?`<span class="updates-badge ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[9px] font-bold">${updatesCount>9?'9+':updatesCount}</span>`:''}</a>`).join('')}</nav>
    <div class="sidebar-spacer"></div>
    <div class="side-footer px-3 pb-3 flex flex-col gap-1">
      <a class="bottom-item flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${active==='/settings'?'active bg-primary-container text-on-primary-container font-bold':'text-on-surface-variant hover:bg-surface-container-high'}" href="#/settings">${mi('settings','text-[20px]',active==='/settings')}<span class="nav-label font-title-md text-[14px]">Settings</span></a>
      <button class="avatar flex items-center gap-3 bg-surface-container p-3 rounded-xl w-full text-left" data-action="profile">
        <span class="w-9 h-9 rounded-full bg-primary text-white grid place-items-center text-[12px] font-bold shrink-0">${avatarLabel()}</span>
        <span class="min-w-0"><span class="block font-label-bold text-[9px] text-on-surface-variant">Welcome</span><span class="block font-title-md text-[12px] text-on-background truncate">${escapeXml(welcomeName)}</span></span>
      </button>
    </div>
  </aside>`;
}
function mobileNav(active){
  const items=[['home','Home','/'],['explore','Explore','/explore'],['bookmark','Saved','/bookmarks'],['library','Library','/library']];
  return `<nav class="mobile-nav lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#1c1b1b]/95 backdrop-blur-xl rounded-full px-2 py-2 shadow-[0_16px_40px_rgba(0,0,0,0.35)] z-50">
    ${items.slice(0,2).map(([i,l,p])=>`<button class="flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-full transition-all ${active===p?'bg-primary text-white':'text-white/60 hover:text-white'}" data-nav="${p}" aria-label="${l}">${mi(i,'text-[20px]')}</button>`).join('')}
    <button class="flex items-center justify-center w-14 h-14 -mt-4 rounded-full bg-primary text-white shadow-[0_10px_24px_rgba(167,58,21,0.5)] shrink-0" data-nav="/explore" aria-label="Search">${mi('search','text-[22px]')}</button>
    ${items.slice(2).map(([i,l,p])=>`<button class="flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-full transition-all ${active===p?'bg-primary text-white':'text-white/60 hover:text-white'}" data-nav="${p}" aria-label="${l}">${mi(i,'text-[20px]')}</button>`).join('')}
  </nav>`;
}
function topbar(){
  return `<div class="topbar flex items-center gap-3 lg:gap-4 sticky top-0 bg-surface/90 backdrop-blur-md z-30 py-3 lg:py-4">
    <a href="#/" class="flex items-center gap-2 lg:hidden shrink-0" aria-label="BUFU"><img class="w-8 h-8 rounded-lg object-cover" src="./assets/bufu-mark.png" alt="BUFU"><span class="font-headline-lg-mobile text-[18px] text-primary font-bold">BUFU</span></a>
    <div class="search relative flex-1 max-w-xl">
      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant search-icon">${mi('search','text-[16px] lg:text-[18px]')}</span>
      <input id="global-search" class="w-full h-9 lg:h-11 rounded-full bg-surface-container-highest pl-11 pr-4 text-[12px] lg:text-[13px] outline-none border border-transparent focus:border-primary transition-colors shadow-inner text-on-background placeholder-on-surface-variant" value="${escapeXml(state.search)}" placeholder="Search manga or manhwa..." aria-label="Search manga or manhwa">
    </div>
    <div class="topbar-spacer hidden lg:block flex-1"></div>
    <button class="avatar w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-primary text-white grid place-items-center text-[11px] lg:text-[12px] font-bold shadow-sm shrink-0" data-action="profile">${avatarLabel()}</button>
  </div>`;
}
function avatarLabel(){ if(state.auth?.user){ const n=state.auth.user.displayName||state.auth.user.email||'U'; return escapeXml(n[0].toUpperCase()) } return '+' }

function notConnectedNotice(){
  return apiBaseConfigured() ? '' : `<div class="empty rounded-2xl border border-dashed border-outline-variant text-center py-12 px-6 mb-6"><h3 class="font-title-md text-[15px] font-bold text-on-background mb-2">Not connected to a BUFU Worker</h3><p class="text-[12px] text-on-surface-variant">Set <code>apiBase</code> in config.js to your deployed Cloudflare Worker URL to load real titles.</p></div>`;
}
function sectionHead(title, right=''){
  return `<div class="section-head flex items-end justify-between mb-4"><h2 class="section-title font-headline-lg text-[19px] lg:text-[22px] font-bold text-on-background">${title}</h2>${right}</div>`;
}
function emptyState(heading, body='', action=''){
  return `<div class="empty rounded-2xl border border-dashed border-outline-variant text-center py-14 px-6"><h3 class="font-title-md text-[15px] font-bold text-on-background mb-2">${heading}</h3>${body?`<p class="text-[12px] text-on-surface-variant max-w-sm mx-auto leading-relaxed">${body}</p>`:''}${action?`<div class="mt-4">${action}</div>`:''}</div>`;
}
const BTN_PRIMARY = 'inline-flex items-center gap-2 h-11 px-6 rounded-full bg-primary text-white text-[12px] font-bold shadow-[0px_10px_24px_rgba(167,58,21,0.24)] hover:-translate-y-0.5 transition-transform';
const BTN_GHOST = 'inline-flex items-center gap-2 h-11 px-6 rounded-full border border-outline-variant text-on-background text-[12px] font-bold hover:bg-surface-container-high transition-colors';

const HOME_GENRES = [['all','All'],['fantasy','Fantasy'],['action','Action'],['romance','Romance'],['comedy','Comedy'],['drama','Drama'],['horror','Horror'],['adventure','Adventure']];

function fannedCarousel(items){
  // A "fanned deck" rail: each card gets a small alternating rotation and
  // pulls left into the previous one, like a spread hand of cards — the
  // reference's signature "Popular This Week" treatment. Still a plain
  // horizontal-scroll rail underneath (same .card class, same data hooks),
  // just with per-card transform/z-index for the fan look; nothing about
  // how a card behaves (click-through, bookmark button, progress bar)
  // changes from the grid layout elsewhere.
  const ROT = [0,-7,6,-5,8,-6,5];
  return `<div class="row-scroll flex overflow-x-auto pb-4 pt-2 px-1" style="scroll-snap-type:x proximity">
    ${items.map((t,i)=>`<div class="shrink-0 w-[150px] sm:w-[168px] transition-transform duration-300 hover:z-20 hover:!rotate-0 hover:!scale-105" style="scroll-snap-align:start;transform:rotate(${ROT[i%ROT.length]}deg);z-index:${items.length-i};margin-left:${i===0?'0':'-28px'}">${card(t)}</div>`).join('')}
  </div>`;
}

function home(){
  if((!state.home.loaded||state.home.genre!==state.homeGenre) && apiBaseConfigured()) setTimeout(loadHomeFeed,0);
  const items=state.home.items;
  const featured = items[0];
  const rail = items.slice(0,7);
  const rest = items.slice(7);
  const welcomeName = state.auth?.user ? (state.auth.user.displayName||state.auth.user.email||'Reader') : 'Guest reader';
  return `<div class="page-enter flex flex-col gap-stack-md">${notConnectedNotice()}
  <div class="flex items-center justify-between lg:hidden -mb-2">
    <div class="flex items-center gap-3">
      <button class="w-11 h-11 rounded-full bg-primary text-white grid place-items-center text-[13px] font-bold shrink-0" data-action="profile">${avatarLabel()}</button>
      <div><p class="text-[11px] text-on-surface-variant leading-none">Welcome</p><p class="font-title-md text-[16px] font-bold text-on-background mt-1">${escapeXml(welcomeName)}!</p></div>
    </div>
    <button class="w-10 h-10 rounded-full grid place-items-center text-on-background hover:bg-surface-container-high" data-nav="/settings" aria-label="Settings">${mi('menu','text-[22px]')}</button>
  </div>
  ${featured?`<section class="hero relative min-h-[260px] lg:min-h-[360px] rounded-2xl lg:rounded-3xl overflow-hidden bg-surface-container-low shadow-[0px_10px_30px_rgba(0,0,0,0.06)]">
    <div class="hero-bg absolute inset-0"><img class="w-full h-full object-cover opacity-25" src="${safeImgSrc(featured.cover)}" alt="" aria-hidden="true"></div>
    <div class="absolute inset-0 bg-gradient-to-t from-surface via-surface/70 to-transparent lg:bg-gradient-to-r lg:from-surface lg:via-surface/85 lg:to-transparent"></div>
    <div class="hero-content relative z-10 flex flex-col justify-end lg:justify-center h-full min-h-[260px] lg:min-h-[360px] px-6 lg:px-12 py-8 max-w-xl">
      <div class="kicker flex items-center gap-2 text-primary uppercase tracking-wider text-[10px] font-bold mb-3"><span class="pulse w-1.5 h-1.5 rounded-full bg-primary"></span>Trending now</div>
      <h1 class="font-display-lg text-[28px] lg:text-[44px] leading-[1.05] font-bold text-on-background mb-3">Read beyond worlds.</h1>
      <p class="text-on-surface-variant leading-relaxed text-[13px] lg:text-[14px] mb-6 max-w-md hidden sm:block">One home for manga, manhwa and manhua — a unified library, source fallback, and a reader that remembers exactly where you stopped.</p>
      <div class="actions flex flex-wrap gap-3">
        <button class="${BTN_PRIMARY}" data-nav="/title/${escapeXml(featured.id)}">${mi('play','text-[16px]')}Read ${escapeXml(featured.title)}</button>
        <button class="${BTN_GHOST} hidden sm:inline-flex" data-nav="/explore">Explore catalog</button>
      </div>
    </div>
  </section>`:''}
  <section class="section">
    <h2 class="font-headline-lg text-[19px] lg:text-[22px] font-bold text-on-background mb-3">Popular This Week</h2>
    <div class="filter-bar flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" style="scrollbar-width:none">${HOME_GENRES.map(([val,label])=>`<button class="shrink-0 px-4 py-2 rounded-full text-[12px] font-bold border transition-colors ${state.homeGenre===val?'bg-transparent border-transparent text-primary underline underline-offset-8 decoration-2':'bg-transparent border-transparent text-on-surface-variant hover:text-on-background'}" data-action="set-home-genre" data-genre="${val}">${label}</button>`).join('')}</div>
    ${state.home.loading?emptyState('Loading recommendations…')
     :state.home.error?emptyState("Couldn't load recommendations", escapeXml(state.home.error), `<button class="${BTN_GHOST}" data-action="retry-home">${mi('refresh','text-[16px]')}Retry</button>`)
     :rail.length?fannedCarousel(rail)
     :apiBaseConfigured()?emptyState('Nothing to show yet', 'Try Explore to search the catalog directly.'):''}
  </section>
  ${rest.length?`<section class="section">${sectionHead('Features', `<a class="section-link text-primary text-[12px] font-bold flex items-center gap-1" href="#/explore">See more ${mi('chevronRight','text-[14px]')}</a>`)}
  <div class="cover-grid grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-7 gap-3">${rest.slice(0,7).map(t=>card(t)).join('')}</div>
  </section>`:''}
  </div>`;
}

function explore(){
  const q=state.search.trim();
  const list=(q?state.remoteSearch:[]).filter(t=>state.exploreType==='all'||t.type===state.exploreType);
  if(state.exploreSort==='rating') list.sort((a,b)=>(b.score||0)-(a.score||0));
  else list.sort((a,b)=>(b.popularity||0)-(a.popularity||0));
  const typeChip = (val,label) => `<button class="chip-select-btn px-4 py-2 rounded-full text-[11px] font-bold border transition-colors ${state.exploreType===val?'bg-primary border-primary text-white':'bg-surface-container border-outline-variant/40 text-on-surface hover:bg-primary hover:text-white hover:border-primary'}" data-action="set-explore-type" data-type="${val}">${label}</button>`;
  return `<div class="page-enter flex flex-col gap-stack-md">${notConnectedNotice()}
  <section class="explore-hero rounded-2xl lg:rounded-3xl bg-surface-container-low p-6 lg:p-10">
    <div class="kicker flex items-center gap-2 text-primary uppercase tracking-wider text-[10px] font-bold mb-2"><span class="pulse w-1.5 h-1.5 rounded-full bg-primary"></span>Discover</div>
    <h2 class="font-display-lg text-[26px] lg:text-[34px] font-bold text-on-background mb-2">Find your next obsession.</h2>
    <p class="text-on-surface-variant text-[13px] max-w-xl leading-relaxed">Search once — BUFU merges the same title across every connected metadata source into one clean result, and marks whether it's readable through MangaDex.</p>
  </section>
  <section class="section">${sectionHead(q?`Results for "${escapeXml(q)}"`:'Search the catalog', q?`<span class="text-on-surface-variant text-[11px]">${list.length} results</span>`:'')}
  ${q?`<div class="filter-bar flex flex-wrap gap-2 mb-4">${typeChip('all','All')}${typeChip('manga','Manga')}${typeChip('manhwa','Manhwa')}${typeChip('manhua','Manhua')}<select class="select h-9 px-4 rounded-full bg-surface-container border border-outline-variant/40 text-on-surface text-[11px] outline-none ml-auto" id="sort-filter"><option value="popular" ${state.exploreSort==='popular'?'selected':''}>Popular</option><option value="rating" ${state.exploreSort==='rating'?'selected':''}>Top rated</option></select></div>`:''}
  ${state.searching?emptyState('Searching connected sources…')
   :state.searchError?emptyState('Search failed', escapeXml(state.searchError), `<button class="${BTN_GHOST}" data-action="retry-search">${mi('refresh','text-[16px]')}Retry</button>`)
   :q&&list.length===0?emptyState('No results', `Nothing matched "${escapeXml(q)}".`)
   :q?`<div class="cover-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-gutter">${list.map(t=>card(t)).join('')}</div>`
   :emptyState('Type a title above and press Enter')}
  </section></div>`;
}

function library(){
  if(!state.auth?.user) return signInPrompt('Library', 'Sign in to build a library that syncs across devices.');
  if(!state.library.loaded){ setTimeout(hydrateAll,0); return `<div class="page-enter">${emptyState('Loading your library…')}</div>`; }
  const items=state.library.items;
  const grouped={reading:[],completed:[],'on-hold':[],'plan-to-read':[],dropped:[]};
  for(const it of items) (grouped[it.status]||grouped.reading).push(it);
  const asCard=it=>card({id:it.title_id,title:it.title,cover:it.cover_url,type:it.type,readable:true},{showProgress:true});
  const stat=(val,label)=>`<div class="stat rounded-2xl bg-surface-container-low p-4 text-center"><div class="stat-value text-[22px] font-bold text-primary">${val}</div><div class="stat-label text-[10px] text-on-surface-variant mt-1">${label}</div></div>`;
  return `<div class="page-enter flex flex-col gap-stack-md">${sectionHead('Library', `<div class="flex items-center gap-3"><a class="flex items-center gap-1 text-on-surface-variant text-[11px] font-bold hover:text-primary" href="#/history">${mi('history','text-[15px]')}History</a><span class="text-on-surface-variant text-[11px]">${items.length} titles</span></div>`)}
  <section class="section"><div class="library-overview rounded-2xl bg-surface-container-low p-5 lg:p-6"><h3 class="font-title-md text-[14px] font-bold text-on-background mb-4">Library Overview</h3><div class="stat-grid grid grid-cols-2 sm:grid-cols-5 gap-3">${stat(grouped.reading.length,'Reading')}${stat(grouped.completed.length,'Completed')}${stat(grouped['on-hold'].length,'On hold')}${stat(grouped['plan-to-read'].length,'Plan to read')}${stat(grouped.dropped.length,'Dropped')}</div></div></section>
  <section class="section">${sectionHead('All titles')}${items.length?`<div class="cover-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-gutter">${items.map(asCard).join('')}</div>`:emptyState('Your library is empty', 'Add titles from their detail page.')}</section></div>`;
}
function signInPrompt(title, sub){
  return `<div class="page-enter flex flex-col gap-stack-md">${sectionHead(escapeXml(title))}${emptyState('Sign in required', escapeXml(sub), `<button class="${BTN_PRIMARY}" data-action="open-login">Sign in / Create account</button>`)}</div>`;
}

function simpleList(kind){
  if(!state.auth?.user) return signInPrompt(kind==='bookmarks'?'Bookmarks':kind==='updates'?'Updates':'History', 'Sign in to sync this across devices.');
  const src = kind==='bookmarks'?state.bookmarks : kind==='updates'?state.updates : state.history;
  if(!src.loaded){ setTimeout(hydrateAll,0); return `<div class="page-enter">${emptyState('Loading…')}</div>`; }
  const title = kind==='bookmarks'?'Bookmarks':kind==='updates'?'Updates':'History';
  // History is genuinely "last opened chapter per title" — the table's
  // PRIMARY KEY is (user_id, title_id), one row per title, overwritten on
  // every open. The UI previously described it as "everything you've
  // recently opened," which isn't what's actually stored; this describes
  // the real semantics instead of promising a full open-event log.
  const sub = kind==='bookmarks'?'Saved series you want one tap away.':kind==='updates'?'Library titles with chapters you haven\'t seen yet.':'The last chapter you opened, for each title.';
  const items=src.items;
  const asCard=it=>card({id:it.title_id,title:it.title,cover:it.cover_url,type:it.type,readable:true},{showProgress:kind!=='bookmarks'});
  return `<div class="page-enter flex flex-col gap-stack-md">${sectionHead(title, `<span class="text-on-surface-variant text-[11px]">${escapeXml(sub)}</span>`)}<section class="section">${items.length?`<div class="cover-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-gutter">${items.map(asCard).join('')}</div>`:emptyState('Nothing here yet')}</section></div>`;
}

async function titleDetail(id){
  const t = await ensureTitle(id);
  if(t==='not-found') return notFoundView('Title Not Found', "This title doesn't exist, or hasn't been discovered by BUFU yet — try searching for it first.");
  if(t==='error') return errorView('Couldn\'t load this title', 'retry-title', id);
  const p=getProgress(t.id);
  const saved=libraryStatus(t.id)!==null;
  const bookmarked=isBookmarked(t.id);
  const chapters = await ensureChapters(id);
  if(state.detailTabTitleId!==id){ state.detailTab='overview'; state.detailTabTitleId=id; }
  const tab=state.detailTab;
  const chapterMarkup = chapters==='error'
    ? emptyState("Couldn't load chapters", '', `<button class="${BTN_GHOST}" data-action="retry-chapters" data-title-id="${escapeXml(id)}">${mi('refresh','text-[16px]')}Retry</button>`)
    : chapters.length===0
      ? emptyState(t.readable?'No chapters found':'Not readable through a connected source', t.readable?'MangaDex has this title but no matching chapters were found.':'This title was discovered through metadata only — no legitimate reader source is mapped to it yet.')
      : `<div class="chapter-list rounded-2xl bg-surface-container-low divide-y divide-outline-variant/30 overflow-hidden">${chapters.map(c=>`<div class="chapter-row flex items-center justify-between gap-4 px-4 lg:px-5 py-3.5 hover:bg-surface-container-high transition-colors"><div class="chapter-main min-w-0"><strong class="block text-[12px] font-semibold text-on-background truncate">Chapter ${c.number===null?'—':escapeXml(String(c.number))}${c.label?` — ${escapeXml(c.label)}`:''}</strong><span class="block text-[10px] text-on-surface-variant mt-1">${c.publishedAt?new Date(c.publishedAt).toLocaleDateString():'—'} · ${c.pagesCount||'—'} pages</span></div><button class="chapter-action shrink-0 px-4 h-9 rounded-full text-[10px] font-bold transition-colors ${p?.chapterId===c.id?'primary bg-primary text-white':'bg-surface-container border border-outline-variant/40 text-on-surface hover:border-primary'}" data-action="open-chapter" data-title-id="${escapeXml(t.id)}" data-chapter-id="${escapeXml(c.id)}">${p?.chapterId===c.id?'Continue':'Read'}</button></div>`).join('')}</div>`;
  const cover=safeImgSrc(t.cover);
  const creatorAvatar=(name)=>`<div class="flex flex-col items-center gap-2 shrink-0 w-20"><span class="w-16 h-16 rounded-full bg-primary-container text-on-primary-container grid place-items-center text-[18px] font-bold shadow-sm">${escapeXml((name[0]||'?').toUpperCase())}</span><span class="text-[11px] font-semibold text-on-background text-center truncate w-full">${escapeXml(name)}</span></div>`;
  const TABS=[['overview','Overview'],['chapters','Chapters'],['creators','Creators']];
  const overviewPane=`<p class="text-on-surface-variant text-[13px] leading-relaxed max-w-2xl">${escapeXml(t.description||'No description available.')}</p>
    <div class="meta-grid grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
      <div class="meta-box rounded-xl bg-surface-container-low p-3"><div class="meta-label text-[9px] text-on-surface-variant uppercase tracking-wide">Format</div><div class="meta-value text-[12px] font-bold mt-1">${escapeXml(t.type||'—')}</div></div>
      <div class="meta-box rounded-xl bg-surface-container-low p-3"><div class="meta-label text-[9px] text-on-surface-variant uppercase tracking-wide">Chapters</div><div class="meta-value text-[12px] font-bold mt-1">${Array.isArray(chapters)?chapters.length:'—'}</div></div>
      <div class="meta-box rounded-xl bg-surface-container-low p-3"><div class="meta-label text-[9px] text-on-surface-variant uppercase tracking-wide">Sources</div><div class="meta-value text-[12px] font-bold mt-1">${(t.sources||[]).length} connected</div></div>
      <div class="meta-box rounded-xl bg-surface-container-low p-3"><div class="meta-label text-[9px] text-on-surface-variant uppercase tracking-wide">Reading mode</div><div class="meta-value text-[12px] font-bold mt-1">${t.readingMode==='vertical'?'Continuous':t.readingMode==='page'?'Page':'Auto'}</div></div>
    </div>`;
  const creatorsPane = (t.author||t.artist)
    ? `<div class="flex flex-wrap gap-5">${[...new Set([t.author,t.artist].filter(Boolean))].map(creatorAvatar).join('')}</div><p class="text-on-surface-variant text-[11px] mt-4">Credited by the connected metadata sources — BUFU doesn't have a character/cast database, so this shows the title's real author and artist instead.</p>`
    : emptyState('No creator credits available', 'None of the connected sources have author/artist data for this title.');
  const pane = tab==='chapters'?chapterMarkup:tab==='creators'?creatorsPane:overviewPane;
  return `<div class="page-enter flex flex-col gap-stack-md">
  <section class="relative rounded-3xl overflow-hidden min-h-[200px] lg:min-h-[280px] bg-surface-container-low">
    <img class="absolute inset-0 w-full h-full object-cover" src="${cover}" alt="" aria-hidden="true" data-fallback-hide>
    <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/10"></div>
    <button class="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm grid place-items-center shadow-sm z-10" data-action="bookmark" data-title-id="${escapeXml(t.id)}" data-bookmarked="${bookmarked}" aria-label="Bookmark">${mi('bookmark','text-[18px] text-primary',bookmarked)}</button>
    <div class="absolute -bottom-10 left-4 lg:left-8 w-24 lg:w-28 rounded-2xl overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.25)] border-4 border-surface bg-surface-container-low" style="aspect-ratio:3/4.2"><img class="w-full h-full object-cover" src="${cover}" alt="${escapeXml(t.title)}" data-fallback="${placeholderCover(t.title)}"></div>
  </section>
  <div class="pl-28 lg:pl-40 pt-2 min-h-[44px]">
    <div class="eyebrow flex items-center gap-2 text-primary uppercase tracking-wider text-[9px] font-bold"><span class="pulse w-1.5 h-1.5 rounded-full bg-primary"></span>${escapeXml(t.status||'unknown')}</div>
    <h1 class="font-display-lg text-[20px] lg:text-[30px] font-bold text-on-background mt-1 leading-tight">${escapeXml(t.title)}</h1>
  </div>
  <div class="flex flex-wrap items-center gap-2 mt-1">
    ${(t.genres||[]).slice(0,4).map((g,i)=>`<span class="px-3 py-1.5 rounded-full text-[10px] font-bold ${i===0?'bg-on-background text-white':'bg-surface-container-low text-on-surface-variant'}">${escapeXml(g)}</span>`).join('')||`<span class="px-3 py-1.5 rounded-full text-[10px] font-bold bg-surface-container-low text-on-surface-variant">${escapeXml(t.type||'Unknown')}</span>`}
  </div>
  <div class="rating flex items-center gap-2"><span class="flex items-center gap-1 text-on-background font-bold text-[14px]">${mi('star','text-[16px] text-primary',true)}${t.score?escapeXml(String(t.score)):'—'} <span class="text-on-surface-variant font-normal text-[11px]">/10</span></span>${t.popularity?`<span class="text-on-surface-variant text-[11px]">From ${fmt(t.popularity)} readers</span>`:''}</div>
  <div class="detail-actions flex flex-wrap gap-3">
    ${t.readable?`<button class="${BTN_PRIMARY}" data-action="read-title" data-title-id="${escapeXml(t.id)}">${mi('play','text-[16px]')}${p?'Continue reading':'Start reading'}</button>`:`<button class="${BTN_GHOST} opacity-60 cursor-not-allowed" disabled title="No legitimate reader source connected yet">Not readable yet</button>`}
    <button class="${BTN_GHOST}" data-action="toggle-library" data-title-id="${escapeXml(t.id)}" data-in-library="${saved}">${mi('library','text-[16px]')}${saved?'In Library':'Add to Library'}</button>
  </div>
  <div class="flex items-center gap-6 border-b border-outline-variant/30 overflow-x-auto" style="scrollbar-width:none">
    ${TABS.map(([val,label])=>`<button class="shrink-0 pb-3 pt-1 text-[13px] font-bold border-b-2 transition-colors ${tab===val?'text-primary border-primary':'text-on-surface-variant border-transparent hover:text-on-background'}" data-action="set-detail-tab" data-tab="${val}">${label}</button>`).join('')}
  </div>
  <section class="section pt-0">${pane}</section>
  </div>`;
}
function notFoundView(title, sub){
  return `<div class="page-enter"><div class="not-found text-center max-w-md mx-auto py-16 px-6"><h2 class="font-headline-lg text-[20px] font-bold text-on-background mb-2">${escapeXml(title)}</h2><p class="text-on-surface-variant text-[12px] mb-6">${escapeXml(sub)}</p><button class="${BTN_PRIMARY}" data-nav="/explore">Back to Explore</button></div></div>`;
}
function errorView(title, retryAction, id){
  return `<div class="page-enter"><div class="not-found text-center max-w-md mx-auto py-16 px-6"><h2 class="font-headline-lg text-[20px] font-bold text-on-background mb-2">${escapeXml(title)}</h2><p class="text-on-surface-variant text-[12px] mb-6">Something went wrong reaching BUFU's backend.</p><button class="${BTN_GHOST}" data-action="${retryAction}" data-title-id="${escapeXml(id)}">${mi('refresh','text-[16px]')}Retry</button></div></div>`;
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
  flushProgressSync(false); // leaving whichever chapter was open — don't lose its debounced progress to the next chapter's render
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
    ? `<div class="empty rounded-2xl border border-dashed border-outline-variant/30 text-center py-14 px-6" style="margin:60px auto;max-width:420px"><h3 class="font-title-md text-[14px] font-bold text-[#f6f1ee] mb-2">Loading pages…</h3><p class="text-[11px] text-[#cdb2a6]">Trying the connected reader source.</p></div>`
    : pages==='error' || (Array.isArray(pages)&&pages.length===0)
      ? `<div class="empty rounded-2xl border border-dashed border-outline-variant/30 text-center py-14 px-6" style="margin:60px auto;max-width:420px"><h3 class="font-title-md text-[14px] font-bold text-[#f6f1ee] mb-2">No source available</h3><p class="text-[11px] text-[#cdb2a6] mb-4">The connected source couldn't serve this chapter right now.</p><button class="inline-flex items-center gap-2 h-10 px-5 rounded-full border border-white/15 text-[#f6f1ee] text-[11px] font-bold hover:bg-white/5" data-action="retry-pages" data-title-id="${escapeXml(titleId)}" data-chapter-id="${escapeXml(chapterId)}">${mi('refresh','text-[16px]')}Retry</button></div>`
      : mode==='vertical'
        ? pages.map((p,i)=>`<div class="reader-page-wrap" data-index="${i}"><img class="reader-page w-full h-auto block" data-index="${i}" src="${safeImgSrc(p.src)}" alt="${escapeXml(p.alt||`Page ${i+1}`)}" loading="${i<2?'eager':'lazy'}" data-retry-src="${safeImgSrc(p.src)}"></div>`).join('')
        : `<img class="reader-page page-centered max-w-full h-auto block mx-auto" data-index="0" src="${safeImgSrc(pages[0].src)}" alt="${escapeXml(pages[0].alt||'Page 1')}" data-retry-src="${safeImgSrc(pages[0].src)}">`;

  return `<div class="reader-shell fixed inset-0 bg-black z-[100] flex flex-col">
  <div class="reader-top h-14 bg-black/90 border-b border-white/10 flex items-center gap-3 px-4 backdrop-blur-xl z-10">
    <button class="reader-btn w-9 h-9 rounded-full bg-white/5 border border-white/10 grid place-items-center text-[#f6f1ee]" data-action="close-reader" data-title-id="${escapeXml(titleId)}" aria-label="Back">${mi('back','text-[18px]')}</button>
    <div class="reader-title min-w-0"><strong class="block text-[12px] text-[#f6f1ee] truncate font-semibold">${escapeXml(t.title)}</strong><span class="block text-[9px] text-[#8b716a] mt-0.5">Chapter ${chapter.number===null?'—':escapeXml(String(chapter.number))} · ${mode==='vertical'?'Continuous':'Page mode'}</span></div>
    <div class="reader-spacer flex-1"></div>
    <button class="reader-btn w-9 h-9 rounded-full bg-white/5 border border-white/10 grid place-items-center text-[#f6f1ee]" data-action="toggle-reader-mode" aria-label="Toggle reading mode">${mi(mode==='vertical'?'pageMode':'verticalMode','text-[18px]')}</button>
    <button class="reader-btn w-9 h-9 rounded-full bg-white/5 border border-white/10 grid place-items-center text-[#f6f1ee]" data-action="fullscreen" aria-label="Fullscreen">${mi('fullscreen','text-[18px]')}</button>
  </div>
  <main class="reader-main flex-1 overflow-auto flex justify-center" id="reader-main"><div class="reader-stack w-full max-w-[980px] flex flex-col items-center pb-10" id="reader-stack">${stack}</div></main>
  <div class="reader-controls fixed left-1/2 -translate-x-1/2 bottom-3 bg-black/85 border border-white/10 rounded-full p-1.5 flex items-center gap-1 backdrop-blur-xl shadow-[0_18px_50px_rgba(0,0,0,0.5)] z-10">
    <button class="reader-chip h-8 px-4 rounded-full text-[#cdb2a6] text-[10px] font-bold hover:bg-white/10" data-action="reader-prev">Prev</button>
    <span id="reader-page-indicator" class="text-[#9aa0ab] text-[10px] px-2"></span>
    <button class="reader-chip h-8 px-4 rounded-full text-[#cdb2a6] text-[10px] font-bold hover:bg-white/10" data-action="reader-next">Next</button>
  </div>
  <div class="reader-progress fixed left-0 right-0 bottom-0 h-[3px] bg-white/10 z-10"><span id="reader-progress-bar" class="block h-full bg-primary"></span></div>
  </div>`;
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
      retryTile.className='retry-tile flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/5 text-[#cdb2a6] text-[11px] px-6 text-center w-full hover:text-primary hover:border-primary transition-colors';
      retryTile.style.aspectRatio = '2/3';
      retryTile.innerHTML=`${mi('refresh','text-[20px]')}<span>Page ${Number(this.dataset.index)+1} failed to load — tap to retry</span>`;
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
  const inputCls='w-full h-11 rounded-xl bg-surface-container-highest border border-transparent focus:border-primary px-4 text-[12px] outline-none shadow-inner text-on-background placeholder-on-surface-variant transition-colors';
  return `<div class="modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-5" data-action="close-modal"><div class="modal-card w-full max-w-[380px] bg-surface rounded-3xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
    <div class="modal-head flex items-center justify-between mb-5"><h3 class="font-title-md text-[16px] font-bold text-on-background">${mode==='login'?'Sign in to BUFU':'Create your BUFU account'}</h3><button class="modal-close w-8 h-8 rounded-full grid place-items-center text-on-surface-variant hover:bg-surface-container-high" data-action="close-modal" aria-label="Close">${mi('close','text-[16px]')}</button></div>
    <form id="auth-form" class="flex flex-col gap-3">
      ${mode==='register'?`<label class="flex flex-col gap-1.5 text-[11px] font-semibold text-on-surface-variant">Display name<input class="${inputCls}" name="displayName" type="text" maxlength="60" placeholder="Reader"></label>`:''}
      <label class="flex flex-col gap-1.5 text-[11px] font-semibold text-on-surface-variant">Email<input class="${inputCls}" name="email" type="email" required placeholder="you@example.com" autocomplete="email"></label>
      <label class="flex flex-col gap-1.5 text-[11px] font-semibold text-on-surface-variant">Password<input class="${inputCls}" name="password" type="password" required minlength="8" placeholder="At least 8 characters" autocomplete="${mode==='login'?'current-password':'new-password'}"></label>
      <div id="auth-error" class="auth-error bg-error-container/40 border border-error/30 text-error text-[11px] px-3 py-2.5 rounded-xl" hidden></div>
      <button class="${BTN_PRIMARY} w-full justify-center mt-1" type="submit">${mode==='login'?'Sign in':'Create account'}</button>
    </form>
    <div class="modal-switch mt-4 text-center text-[11px] text-on-surface-variant">${mode==='login'?`New to BUFU? <button type="button" class="text-primary font-bold" data-action="switch-auth" data-mode="register">Create an account</button>`:`Already have an account? <button type="button" class="text-primary font-bold" data-action="switch-auth" data-mode="login">Sign in</button>`}</div>
  </div></div>`;
}
function renderModal(){
  const root=document.getElementById('modal-root'); if(!root) return;
  root.innerHTML = state.modal ? authModal(state.modal) : '';
  if(state.modal){
    $('#auth-form')?.addEventListener('submit', onAuthSubmit);
    // Card clicks must not bubble to the overlay's close-modal listener below
    // (CSP disallows the inline onclick="event.stopPropagation()" this used to use).
    $('.modal-card')?.addEventListener('click', (e)=>e.stopPropagation());
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

function settingsCard(title, body){
  return `<div class="overview-card rounded-2xl bg-surface-container-low p-5 lg:p-6"><h3 class="font-title-md text-[14px] font-bold text-on-background mb-3">${title}</h3>${body}</div>`;
}
function chipSelect(items, action, current){
  return `<div class="chip-select flex flex-wrap gap-2">${items.map(m=>`<button data-action="${action}" data-mode="${m}" class="px-4 py-2 rounded-full text-[11px] font-bold border transition-colors ${current===m?'active bg-primary border-primary text-white':'bg-surface-container border-outline-variant/40 text-on-surface hover:border-primary'}">${m[0].toUpperCase()+m.slice(1)}</button>`).join('')}</div>`;
}
function settings(){
  return `<div class="page-enter flex flex-col gap-stack-md">${sectionHead('Settings', `<span class="text-on-surface-variant text-[11px]">Tune BUFU to the way you read.</span>`)}
  <section class="section">${settingsCard('Account', state.auth?.user?`<p class="text-on-surface-variant text-[11px] leading-relaxed mb-4">Signed in as <strong class="text-on-background">${escapeXml(state.auth.user.email)}</strong>. Library, bookmarks, history and progress sync to this account.</p><button class="${BTN_GHOST}" data-action="logout">${mi('logout','text-[16px]')}Sign out</button>`:`<p class="text-on-surface-variant text-[11px] leading-relaxed mb-4">Sign in to sync your library, bookmarks, history and reading progress across devices.</p><button class="${BTN_PRIMARY}" data-action="open-login">Sign in / Create account</button>`)}</section>
  <section class="section">${settingsCard('Theme', chipSelect(['light','dark','system'],'set-theme',state.theme))}</section>
  <section class="section">${settingsCard('Reader mode', `<p class="text-on-surface-variant text-[11px] leading-relaxed mb-4">Auto picks page mode for manga and continuous mode for manhwa/manhua, from each title's verified original language — you can override per session.</p>${chipSelect(['auto','page','vertical'],'set-reader-mode',state.readerMode)}`)}</section>
  <section class="section">${settingsCard('Source engine', `<p class="text-on-surface-variant text-[11px] leading-relaxed">MangaDex is BUFU's only reader-capable source right now. AniList, Jikan, Kitsu, MangaUpdates and SHIRO contribute metadata and discovery — a title found only through them shows as metadata until a legitimate reader source is mapped to it.</p>`)}</section></div>`;
}

// Monotonic token for the in-flight route render. render() is async (it
// awaits titleDetail()/reader(), both of which hit the network), and
// hashchange can fire again — a fast back-tap, a card double-click, a
// programmatic nav() right after another — before the previous run()'s
// await resolves. Without a guard, whichever fetch happens to resolve
// LAST wins the innerHTML write, even if it was for a route the user has
// since navigated away from. Every run() captures the generation at start
// and re-checks it after every await; a stale generation bails out
// without touching the DOM instead of overwriting newer content.
let renderGen = 0;
function render(){
  const myGen = ++renderGen;
  const path=currentPath();
  const readMatch=path.match(/^\/read\/([^/]+)\/([^/]+)$/);
  const run = async () => {
    let content='', active='/';
    if(!readMatch && readerCleanup){ readerCleanup(); readerCleanup=null; flushProgressSync(false); } // left the reader via any route, not just /title/
    if(readMatch){
      content = await reader(decodeURIComponent(readMatch[1]), decodeURIComponent(readMatch[2]));
      if(myGen !== renderGen) return; // a newer navigation already started while this one was loading
      $('#app').innerHTML = content; bind(); return;
    }
    if(path==='/') { content=home(); active='/'; }
    else if(path.startsWith('/explore')){ content=explore(); active='/explore'; }
    else if(path.startsWith('/library')){ content=library(); active='/library'; }
    else if(path.startsWith('/history')){ content=simpleList('history'); active='/history'; }
    else if(path.startsWith('/bookmarks')){ content=simpleList('bookmarks'); active='/bookmarks'; }
    else if(path.startsWith('/updates')){ content=simpleList('updates'); active='/updates'; }
    else if(path.startsWith('/settings')){ content=settings(); active='/settings'; }
    else if(path.startsWith('/title/')){ if(readerCleanup){readerCleanup();readerCleanup=null;} flushProgressSync(false); content = await titleDetail(decodeURIComponent(path.split('/')[2])); active=''; }
    else { content=home(); active='/'; }
    if(myGen !== renderGen) return; // a newer navigation already started while this one was loading
    $('#app').innerHTML=`<div class="app-shell flex h-screen overflow-hidden bg-surface text-on-background">${sidebar(active)}<main class="main flex-1 overflow-y-auto overflow-x-hidden pb-20 lg:pb-0"><div class="container max-w-[1600px] mx-auto px-4 lg:px-8">${topbar()}<div class="pb-16">${content}</div></div></main>${mobileNav(active)}</div>`;
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
  if(a==='set-explore-type'){ state.exploreType=e.currentTarget.dataset.type; render(); }
  if(a==='set-home-genre'){ state.homeGenre=e.currentTarget.dataset.genre; state.home.loaded=false; render(); }
  if(a==='set-detail-tab'){ state.detailTab=e.currentTarget.dataset.tab; render(); }
  if(a==='set-theme'){ state.theme=e.currentTarget.dataset.mode; try{localStorage.setItem('bufu_theme',state.theme)}catch{}; applyTheme(); render(); }
  if(a==='set-reader-mode'){ state.readerMode=e.currentTarget.dataset.mode; try{localStorage.setItem('bufu_reader_mode',state.readerMode)}catch{}; render(); toast('Reader mode saved'); }
  if(a==='bookmark'){ e.stopPropagation(); const id=e.currentTarget.dataset.titleId; toggleBookmark(id, e.currentTarget.dataset.bookmarked==='true'); }
  if(a==='toggle-library'){ const id=e.currentTarget.dataset.titleId; toggleLibrary(id, e.currentTarget.dataset.inLibrary!=='true'); }
  if(a==='read-title'){ const id=e.currentTarget.dataset.titleId; const p=getProgress(id); nav(`/read/${id}/${p?.chapterId || 'latest'}`); }
  if(a==='open-chapter'){ nav(`/read/${e.currentTarget.dataset.titleId}/${e.currentTarget.dataset.chapterId}`); }
  if(a==='close-reader'){ flushProgressSync(false); nav('/title/'+e.currentTarget.dataset.titleId); }
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
function hideSplash(){
  const splash = document.getElementById('splash');
  if(!splash) return;
  splash.classList.add('hidden');
  setTimeout(() => splash.remove(), 500);
}

window.addEventListener('hashchange',render);
applyTheme();
render();
restoreSession();

// Reveal BUFU when the initial Home load finishes,
// but never keep the splash longer than 5 seconds.
let splashHidden = false;

function finishSplash(){
  if(splashHidden) return;
  splashHidden = true;
  hideSplash();
}

const splashTimeout = setTimeout(finishSplash, 5000);

if(state.home.loaded){
  clearTimeout(splashTimeout);
  finishSplash();
}

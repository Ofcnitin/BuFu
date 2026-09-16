import type { ProviderTitle } from '../types';
import { fetchJson } from '../utils';
import { register, type SourceAdapter } from './registry';

// Verified: https://docs.anilist.co/guide/rate-limiting — the API is
// currently in a degraded state, capped at 30 req/min (down from the
// normal 90/min); throttled at 30/min in ratelimit.ts accordingly. No key
// needed for the public catalogue queries used here.
const QUERY = `query ($search:String){Page(page:1,perPage:20){media(type:MANGA,search:$search){id title{romaji english native} synonyms description(asHtml:false) format status averageScore popularity coverImage{large} countryOfOrigin genres authors:staff(sort:RELEVANCE){edges{role node{name{full}}}}}}}`;
// Verified: AniList's Page.media accepts `genre` and `sort` args (documented
// GraphQL schema, e.g. sort: POPULARITY_DESC) — used for category-based
// discovery rather than reusing search() with the category name as a text
// query, which would just be a relabeled search, not real recommendations.
const TRENDING_QUERY = `query ($genre:String){Page(page:1,perPage:20){media(type:MANGA,sort:POPULARITY_DESC,genre:$genre){id title{romaji english native} synonyms description(asHtml:false) format status averageScore popularity coverImage{large} countryOfOrigin genres authors:staff(sort:RELEVANCE){edges{role node{name{full}}}}}}}`;

function mapMedia(x: any): ProviderTitle {
  const country = String(x.countryOfOrigin || '').toUpperCase();
  const type = country === 'KR' ? 'manhwa' : country === 'CN' || country === 'TW' || country === 'HK' ? 'manhua' : country === 'JP' ? 'manga' : 'unknown';
  const author = (x.authors?.edges || []).find((e: any) => /story|author/i.test(e.role || ''))?.node?.name?.full;
  return {
    sourceId: 'anilist',
    sourceTitleId: String(x.id),
    sourceUrl: `https://anilist.co/manga/${x.id}`,
    title: x.title?.english || x.title?.romaji || x.title?.native || 'Untitled',
    altTitles: [x.title?.romaji, x.title?.native, ...(x.synonyms || [])].filter(Boolean),
    description: x.description || undefined,
    type,
    contentRating: 'unknown', // AniList doesn't expose the safe/suggestive/erotica/pornographic axis MangaDex uses
    readingMode: type === 'manga' ? 'page' : type === 'unknown' ? 'auto' : 'vertical',
    status: (String(x.status || '').toLowerCase() as any) || 'unknown',
    author,
    genres: x.genres || [],
    score: typeof x.averageScore === 'number' ? x.averageScore / 10 : undefined,
    popularity: x.popularity,
    cover: x.coverImage?.large,
  };
}

const adapter: SourceAdapter = {
  id: 'anilist', name: 'AniList', role: 'metadata', production: true, configured: () => true,
  async search(env, q) {
    const r = await fetchJson(env.ANILIST_URL || 'https://graphql.anilist.co', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { search: q } }),
    }, 8000, 'anilist');
    return (r?.data?.Page?.media || []).map(mapMedia);
  },
  async recommendations(env, category) {
    const genre = category ? category[0].toUpperCase() + category.slice(1).toLowerCase() : undefined;
    const r = await fetchJson(env.ANILIST_URL || 'https://graphql.anilist.co', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: TRENDING_QUERY, variables: { genre } }),
    }, 8000, 'anilist');
    return (r?.data?.Page?.media || []).map(mapMedia);
  },
  async health(env) {
    try {
      await fetchJson(env.ANILIST_URL || 'https://graphql.anilist.co', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'query{__typename}' }),
      }, 5000, 'anilist');
      return true;
    } catch { return false; }
  },
};
register(adapter);

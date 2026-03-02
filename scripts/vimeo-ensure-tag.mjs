#!/usr/bin/env node

const API_BASE = 'https://api.vimeo.com';
const token = process.env.VIMEO_ACCESS_TOKEN;

if (!token) {
  console.error('Missing VIMEO_ACCESS_TOKEN in environment.');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tagFlagIndex = args.findIndex((arg) => arg === '--tag');
const tag =
  tagFlagIndex >= 0 && args[tagFlagIndex + 1] ? String(args[tagFlagIndex + 1]).trim() : 'Module 1';

if (!tag) {
  console.error('Tag cannot be empty.');
  process.exit(1);
}

const request = async (path, init = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
      Authorization: `bearer ${token}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} :: ${body.slice(0, 300)}`);
  }

  if (response.status === 204) {
    return null;
  }
  return response.json();
};

const extractVideoId = (uri) => {
  const match = String(uri || '').match(/\/videos\/(\d+)/);
  return match ? match[1] : null;
};

const fetchAllVideos = async () => {
  const videos = [];
  let page = 1;

  while (true) {
    const payload = await request(`/me/videos?per_page=100&page=${page}`);
    const pageItems = Array.isArray(payload?.data) ? payload.data : [];
    videos.push(...pageItems);

    const next = payload?.paging?.next;
    if (!next || pageItems.length === 0) {
      break;
    }
    page += 1;
  }

  return videos;
};

const fetchVideoTags = async (videoId) => {
  const payload = await request(`/videos/${videoId}/tags?per_page=100`);
  const names = Array.isArray(payload?.data)
    ? payload.data
        .map((item) => item?.tag)
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  return names;
};

const ensureTagOnVideo = async (videoId, tagValue) => {
  const encoded = encodeURIComponent(tagValue);
  await request(`/videos/${videoId}/tags/${encoded}`, { method: 'PUT' });
};

const main = async () => {
  console.log(`Ensuring tag "${tag}" on all Vimeo uploads${dryRun ? ' (dry run)' : ''}...`);
  const videos = await fetchAllVideos();
  console.log(`Found ${videos.length} videos.`);

  let alreadyTagged = 0;
  let updated = 0;
  let failed = 0;

  for (const video of videos) {
    const videoId = extractVideoId(video?.uri);
    const name = String(video?.name || `Video ${videoId || 'unknown'}`);

    if (!videoId) {
      console.warn(`Skipping video with unrecognized URI: ${video?.uri || '(missing)'}`);
      failed += 1;
      continue;
    }

    try {
      const tags = await fetchVideoTags(videoId);
      const hasTag = tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());

      if (hasTag) {
        alreadyTagged += 1;
        console.log(`[skip] ${videoId} :: ${name} (already tagged)`);
        continue;
      }

      if (dryRun) {
        updated += 1;
        console.log(`[plan] ${videoId} :: ${name} (would add "${tag}")`);
        continue;
      }

      await ensureTagOnVideo(videoId, tag);
      updated += 1;
      console.log(`[add] ${videoId} :: ${name}`);
    } catch (error) {
      failed += 1;
      console.warn(`[fail] ${videoId} :: ${name} :: ${error.message}`);
    }
  }

  console.log('');
  console.log('Summary');
  console.log(`- Total videos: ${videos.length}`);
  console.log(`- Already tagged: ${alreadyTagged}`);
  console.log(`- Updated: ${updated}`);
  console.log(`- Failed: ${failed}`);

  if (failed > 0) {
    process.exit(2);
  }
};

main().catch((error) => {
  console.error(`Unexpected error: ${error.message}`);
  process.exit(1);
});

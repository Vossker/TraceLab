import { PublicBilibiliProvider } from '../apps/api/public-bilibili';
// Explicit manual diagnostic: no retries, cookies, alternate endpoints or mock data.
const provider = new PublicBilibiliProvider();
try {
  const data = await provider.collect(process.argv[2] || '2', (progress, message) => console.log(`${progress}% ${message}`));
  console.log(JSON.stringify({ result: 'real-data', creator: data.creator.name, uid: data.creator.id, videos: data.videos.length, collectedAt: data.collectedAt, coverage: data.coverage, warnings: data.warnings }, null, 2));
} catch (e) { console.log(JSON.stringify({ result: 'unavailable', checkedAt: new Date().toISOString(), error: e instanceof Error ? e.message : 'failed', status: provider.status() }, null, 2)); process.exitCode = 1; }

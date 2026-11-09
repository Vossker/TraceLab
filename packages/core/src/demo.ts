import { datasetSchema, type Dataset } from './model';

const titles: Record<string, string[]> = {
  '数码科技': ['旧相机还值得买吗？我的周末实测', '用了三个月，这副耳机留下了什么', '300 元的桌面小升级', '不用旗舰手机，也能拍好日常', '一个普通人的键盘选择', '给旧电脑一次重新开始的机会'],
  '影像记录': ['在城市醒来之前，走一段路', '把一个普通的周末拍成电影', '雨天的街道，藏着另一种颜色', '带一台相机去海边', '记录窗外的四季变化', '慢下来之后，我看到了什么'],
  '生活实验': ['连续 30 天不刷短视频，生活会怎样？', '把房间改成一个小小的工作室', '试着用 100 元认真过一个周末', '用一周时间，修好生活里的小麻烦', '早起一小时，真的能改变什么吗？', '把通勤时间还给自己的一次实验', '一张纸，重新安排我的一周', '不买新东西的 30 天，我留下了什么'],
  '创作手记': ['这期视频背后，删掉的那些镜头', '我开始接受不完美的创作', '做完一个系列之后的复盘', '从一个问题，到一条完整的视频', '为什么最近的节奏变慢了', '创作两年，我想保留的东西'],
};
export function createDemo(): Dataset {
  let seed = 48271;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const collectedAt = '2026-01-15T08:00:00.000Z';
  const videos: Dataset['videos'] = [];
  let index = 0;
  for (let year = 2022; year <= 2025; year++) {
    const perMonth = year === 2022 ? 1 : year === 2023 ? 2 : 3;
    for (let month = 0; month < 12; month++) for (let slot = 0; slot < perMonth; slot++) {
      const roll = random();
      const topic = year === 2022 ? ['数码科技', '影像记录', '生活实验'][index % 3] : year === 2023 ? (roll < (month < 3 ? 0.45 : 0.9) ? '生活实验' : roll < 0.96 ? '数码科技' : '影像记录') : year === 2024 ? (roll < 0.82 ? '生活实验' : '影像记录') : (roll < 0.53 ? '创作手记' : roll < 0.92 ? '生活实验' : '影像记录');
      const base = year === 2022 ? 14500 : year === 2023 ? 36000 : year === 2024 ? 87000 : 96000;
      let views = Math.round(base * (0.45 + random() * 1.4) * (1 + 0.16 * Math.sin(month)));
      let title = titles[topic][Math.floor(random() * titles[topic].length)];
      if (year === 2023 && month === 7 && slot === 0) { views = 396800; title = '我把手机变成了「功能机」，生活有什么变化？'; }
      if (year === 2024 && month === 5 && slot === 1) { views = 1284600; title = '不买新东西的 100 天，我找回了生活的主动权'; }
      if (year === 2025 && month === 2 && slot === 0) { views = 684200; title = '做了三年生活实验，我决定不再追求「高效」'; }
      const ratio = 0.028 + random() * 0.038;
      videos.push({ id: `demo-${String(index + 1).padStart(3, '0')}`, title, description: `以个人体验记录${topic}，展示尝试的过程、细节和复盘。本条为合成演示作品。`, tags: [topic],
        publishedAt: new Date(Date.UTC(year, month, 4 + slot * 9 + Math.floor(random() * 4), 10)).toISOString(), collectedAt,
        views, likes: Math.round(views * ratio), coins: Math.round(views * ratio * 0.26), favorites: Math.round(views * ratio * (topic === '生活实验' ? 0.7 : 0.3)), comments: Math.round(views * 0.003 * (0.5 + random())), shares: Math.round(views * 0.002),
        duration: 320 + Math.floor(random() * 350), format: 'video', topic, topicSource: 'provided', cover: null, url: null, source: 'TraceLab 合成演示数据 v1',
      });
      index++;
    }
  }
  const sampleText = ['喜欢这种真实的过程记录，不是只有成功的结果。', '细节很实用，我也想尝试一周。', '和以前相比，越来越喜欢现在的风格。', '中间的节奏有点拖沓，希望剪辑可以紧凑一点。', '真实记录失败的部分反而更有启发。', '最近风格变化很明显，不过也怀念以前的测评。', '这期太长了，结论可以再早一点出现。', '看完学到一个很有用的方法。', '比起结果，我更关心过程里的细节。', '节奏慢下来之后，反而更容易看进去。', '不是所有办法都适合每个人，感谢讲出限制。', '希望下次能看看坚持一段时间后的变化。'];
  const sampled = [...videos].sort((a, b) => b.views! - a.views!).slice(0, 3);
  return datasetSchema.parse({ version: 1, mode: 'demo', creator: { id: 'demo-linjian', platform: 'bilibili', name: '林间实验室', bio: '把好奇心变成生活里的小实验。记录尝试，也记录改变。', avatar: null, url: null, followers: 128600 }, videos,
    comments: sampleText.map((text, i) => ({ id: `demo-comment-${i + 1}`, videoId: sampled[i % 3].id, text, likes: 8 + i * 7, collectedAt, source: '合成演示评论，非真实观众反馈' })),
    collectedAt, source: 'TraceLab 合成演示数据 v1', coverage: '2022–2025 年的 108 条合成作品；12 条合成评论，覆盖播放量最高的 3 条作品。', totalVideos: videos.length,
    warnings: ['创作者、视频、粉丝与评论均为虚构，专用于说明分析方法。此演示的内容标签为预置标签，未调用 AI。'],
  });
}

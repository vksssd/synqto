// ─── Universal Multi-Platform Resource Detector ───

export interface DetectedResource {
  platform: string;
  slug: string;
  title: string;
  url: string;
  canonicalUrl: string;
}

export function detectResource(urlStr: string, documentTitle?: string): DetectedResource | null {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // 1. LeetCode
    if (hostname.includes('leetcode.com')) {
      const match = pathname.match(/\/problems\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const slug = match[1];
        const title = formatSlugToTitle(slug);
        return {
          platform: 'LeetCode',
          slug,
          title,
          url: urlStr,
          canonicalUrl: `https://leetcode.com/problems/${slug}/`,
        };
      }
    }

    // 2. NeetCode
    if (hostname.includes('neetcode.io')) {
      const match = pathname.match(/\/problems\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const slug = match[1];
        const title = formatSlugToTitle(slug);
        return {
          platform: 'NeetCode',
          slug,
          title,
          url: urlStr,
          canonicalUrl: `https://neetcode.io/problems/${slug}`,
        };
      }
    }

    // 3. Codeforces
    if (hostname.includes('codeforces.com')) {
      const probMatch = pathname.match(/\/(?:contest|problemset\/problem)\/(\d+)\/([A-Z0-9]+)/i);
      if (probMatch) {
        const contestId = probMatch[1];
        const problemIndex = probMatch[2].toUpperCase();
        const slug = `cf-${contestId}-${problemIndex}`;
        return {
          platform: 'Codeforces',
          slug,
          title: `Codeforces ${contestId}${problemIndex}`,
          url: urlStr,
          canonicalUrl: `https://codeforces.com/problemset/problem/${contestId}/${problemIndex}`,
        };
      }
    }

    // 4. HackerRank
    if (hostname.includes('hackerrank.com')) {
      const match = pathname.match(/\/challenges\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const slug = match[1];
        return {
          platform: 'HackerRank',
          slug,
          title: formatSlugToTitle(slug),
          url: urlStr,
          canonicalUrl: `https://www.hackerrank.com/challenges/${slug}/problem`,
        };
      }
    }

    // 5. CodeChef
    if (hostname.includes('codechef.com')) {
      const match = pathname.match(/\/problems\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const slug = match[1];
        return {
          platform: 'CodeChef',
          slug,
          title: `CodeChef ${slug}`,
          url: urlStr,
          canonicalUrl: `https://www.codechef.com/problems/${slug}`,
        };
      }
    }

    // 6. GeeksforGeeks
    if (hostname.includes('geeksforgeeks.org')) {
      const match = pathname.match(/\/problems\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const slug = match[1];
        return {
          platform: 'GeeksforGeeks',
          slug,
          title: formatSlugToTitle(slug),
          url: urlStr,
          canonicalUrl: `https://www.geeksforgeeks.org/problems/${slug}/1`,
        };
      }
    }

    // 7. YouTube (Lectures & Solutions)
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      let videoId = parsed.searchParams.get('v');
      if (!videoId && hostname.includes('youtu.be')) {
        videoId = pathname.slice(1);
      }
      if (!videoId && pathname.includes('/shorts/')) {
        videoId = pathname.split('/shorts/')[1]?.split('/')[0];
      }

      if (videoId) {
        const title = documentTitle ? cleanYouTubeTitle(documentTitle) : `YouTube Video (${videoId})`;
        return {
          platform: 'YouTube',
          slug: `yt-${videoId}`,
          title,
          url: urlStr,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      }
    }

    // 8. ArXiv Papers
    if (hostname.includes('arxiv.org')) {
      const match = pathname.match(/\/(?:abs|pdf)\/(\d+\.\d+(?:v\d+)?)/);
      if (match && match[1]) {
        const paperId = match[1];
        return {
          platform: 'ArXiv',
          slug: `arxiv-${paperId.replace(/\./g, '-')}`,
          title: documentTitle ? cleanArxivTitle(documentTitle) : `ArXiv ${paperId}`,
          url: urlStr,
          canonicalUrl: `https://arxiv.org/abs/${paperId}`,
        };
      }
    }

    // 9. GitHub (Issues / Pull Requests / Repos)
    if (hostname.includes('github.com')) {
      const match = pathname.match(/^\/([^\/]+)\/([^\/]+)\/(?:issues|pull)\/(\d+)/);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        const number = match[3];
        return {
          platform: 'GitHub',
          slug: `gh-${owner}-${repo}-${number}`,
          title: `${owner}/${repo} #${number}`,
          url: urlStr,
          canonicalUrl: `https://github.com/${owner}/${repo}/issues/${number}`,
        };
      }
    }

    // Generic fallback for custom URLs
    const slug = hostname.replace(/\./g, '-');
    return {
      platform: 'Web',
      slug: slug || 'general-study',
      title: documentTitle || hostname || 'General Study Room',
      url: urlStr,
      canonicalUrl: urlStr,
    };
  } catch (e) {
    return null;
  }
}

function formatSlugToTitle(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function cleanYouTubeTitle(title: string): string {
  return title.replace(/\s*-\s*YouTube\s*$/, '').trim();
}

function cleanArxivTitle(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, '').replace(/\s*-\s*arXiv.*$/, '').trim();
}

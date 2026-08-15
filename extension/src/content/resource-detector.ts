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

    // 1. LeetCode (Global + China)
    if (hostname.includes('leetcode.com') || hostname.includes('leetcode.cn')) {
      const match = pathname.match(/\/problems\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const slug = match[1];
        const title = formatSlugToTitle(slug);
        const domain = hostname.includes('leetcode.cn') ? 'leetcode.cn' : 'leetcode.com';
        return {
          platform: 'LeetCode',
          slug,
          title,
          url: urlStr,
          canonicalUrl: `https://${domain}/problems/${slug}/`,
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

    // 3. Codeforces (Contest, Problemset, Gym)
    if (hostname.includes('codeforces.com') || hostname.includes('codeforces.net')) {
      const cfMatch = pathname.match(
        /\/(?:contest\/(\d+)\/problem|problemset\/problem\/(\d+)|gym\/(\d+)\/problem)\/([a-zA-Z0-9]+)/i
      );
      if (cfMatch) {
        const contestId = cfMatch[1] || cfMatch[2] || cfMatch[3];
        const problemIndex = cfMatch[4].toUpperCase();
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

    // 4. AtCoder
    if (hostname.includes('atcoder.jp')) {
      const atCoderMatch = pathname.match(/\/contests\/([a-zA-Z0-9-_]+)\/tasks\/([a-zA-Z0-9-_]+)/);
      if (atCoderMatch) {
        const contest = atCoderMatch[1];
        const taskId = atCoderMatch[2];
        return {
          platform: 'AtCoder',
          slug: `atcoder-${taskId}`,
          title: formatSlugToTitle(taskId),
          url: urlStr,
          canonicalUrl: `https://atcoder.jp/contests/${contest}/tasks/${taskId}`,
        };
      }
    }

    // 5. HackerRank
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

    // 6. CodeChef
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

    // 7. GeeksforGeeks
    if (hostname.includes('geeksforgeeks.org')) {
      const match = pathname.match(/\/problems\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        const slug = match[1];
        const cleanSlug = slug.replace(/-\d{6,}$/, '');
        return {
          platform: 'GeeksforGeeks',
          slug,
          title: formatSlugToTitle(cleanSlug),
          url: urlStr,
          canonicalUrl: `https://www.geeksforgeeks.org/problems/${slug}/1`,
        };
      }
    }

    // 8. YouTube (Lectures & Solutions)
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

    // 9. ArXiv Papers
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

    // 10. GitHub (Issues / Pull Requests / Repos)
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

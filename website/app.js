// ─── Nerd Buddy Landing Page Client-Side Interactive Logic ───

document.addEventListener('DOMContentLoaded', () => {
  // 1. Mobile Menu Toggle
  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
      if (navLinks.classList.contains('active')) {
        navLinks.style.display = 'flex';
        navLinks.style.flexDirection = 'column';
        navLinks.style.position = 'absolute';
        navLinks.style.top = '72px';
        navLinks.style.left = '0';
        navLinks.style.width = '100%';
        navLinks.style.background = '#0a0d14';
        navLinks.style.padding = '20px';
        navLinks.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
      } else {
        navLinks.style.display = '';
      }
    });
  }

  // 2. Sticky Navbar Blur Transition
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      navbar.style.background = 'rgba(7, 9, 14, 0.9)';
      navbar.style.borderBottomColor = 'rgba(255, 255, 255, 0.12)';
    } else {
      navbar.style.background = 'rgba(7, 9, 14, 0.7)';
      navbar.style.borderBottomColor = 'rgba(255, 255, 255, 0.08)';
    }
  });

  // 3. Interactive Sandbox Simulator
  const urlInput = document.getElementById('sandbox-url-input');
  const hashBtn = document.getElementById('sandbox-hash-btn');
  const resPlatform = document.getElementById('res-platform');
  const resSlug = document.getElementById('res-slug');
  const resRoomId = document.getElementById('res-room-id');
  const presetBtns = document.querySelectorAll('.preset-btn');

  function computeHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return hex;
  }

  function simulateRoomHash(rawUrl) {
    if (!rawUrl) return;

    let platform = 'Generic Coding Site';
    let slug = 'problem';

    const urlLower = rawUrl.toLowerCase();

    if (urlLower.includes('leetcode.com/problems/')) {
      platform = 'LeetCode';
      const match = rawUrl.match(/\/problems\/([^/?#]+)/i);
      if (match) slug = match[1];
    } else if (urlLower.includes('codeforces.com/problemset/problem/')) {
      platform = 'Codeforces';
      const match = rawUrl.match(/\/problemset\/problem\/([^/?#]+)\/([^/?#]+)/i);
      if (match) slug = `cf-${match[1]}-${match[2]}`;
    } else if (urlLower.includes('neetcode.io/problems/')) {
      platform = 'NeetCode';
      const match = rawUrl.match(/\/problems\/([^/?#]+)/i);
      if (match) slug = match[1];
    } else if (urlLower.includes('hackerrank.com/challenges/')) {
      platform = 'HackerRank';
      const match = rawUrl.match(/\/challenges\/([^/?#]+)/i);
      if (match) slug = match[1];
    } else {
      const parts = rawUrl.split('/').filter(Boolean);
      slug = parts[parts.length - 1] || 'problem';
    }

    const hash = computeHash(rawUrl.split('?')[0].split('#')[0]);
    const roomId = `room:${slug}-${hash}`;

    if (resPlatform) resPlatform.innerText = platform;
    if (resSlug) resSlug.innerText = slug;
    if (resRoomId) resRoomId.innerText = roomId;
  }

  if (hashBtn && urlInput) {
    hashBtn.addEventListener('click', () => {
      simulateRoomHash(urlInput.value.trim());
    });

    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        simulateRoomHash(urlInput.value.trim());
      }
    });
  }

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetUrl = btn.getAttribute('data-url');
      if (targetUrl && urlInput) {
        urlInput.value = targetUrl;
        simulateRoomHash(targetUrl);
      }
    });
  });

  // Initial calculation
  if (urlInput) {
    simulateRoomHash(urlInput.value.trim());
  }

  // 4. Interactive Spoiler Demo
  const demoSpoiler = document.getElementById('demo-spoiler');
  if (demoSpoiler) {
    demoSpoiler.addEventListener('click', () => {
      demoSpoiler.classList.toggle('revealed');
    });
  }

  // 5. 1-Click Code Copy Snippets
  const copyBtns = document.querySelectorAll('.copy-btn');
  copyBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const textToCopy = (e.currentTarget).getAttribute('data-copy') || '';
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy);
        const originalText = (e.currentTarget).innerText;
        (e.currentTarget).innerText = '✓ Copied';
        setTimeout(() => {
          (e.currentTarget).innerText = originalText;
        }, 1500);
      }
    });
  });

  // 6. FAQ Accordion Toggle
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach((item) => {
    const questionBtn = item.querySelector('.faq-question');
    questionBtn?.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      faqItems.forEach((other) => other.classList.remove('active'));
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
});

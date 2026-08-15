// ─── Nerd Buddy Landing Page Client-Side Interactive Logic (Dual-Peer Mesh & Checklist) ───

document.addEventListener('DOMContentLoaded', () => {
  // 0. Initialize Lucide Icons
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }

  // Toast notification helper
  function showToast(message, icon = 'check-circle-2') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i data-lucide="${icon}" class="icon-sm" style="color:#10b981;"></i><span>${message}</span>`;
    container.appendChild(toast);

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons({ root: toast });
    }

    setTimeout(() => {
      toast.style.transition = 'all 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

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

  // 3. Interactive Dual-Peer Live Sandbox Laser & Chat Mirroring
  const codeEditor1 = document.getElementById('code-interactive-1');
  const localLaser = document.getElementById('alice-local-laser');
  const remoteLaser = document.getElementById('bob-remote-laser');

  if (codeEditor1 && localLaser && remoteLaser) {
    codeEditor1.addEventListener('mousemove', (e) => {
      const rect = codeEditor1.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const xPct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const yPct = Math.max(0, Math.min(100, (y / rect.height) * 100));

      localLaser.style.opacity = '1';
      localLaser.style.left = `${x}px`;
      localLaser.style.top = `${y}px`;

      // Mirror directly to Bob's window in real-time
      remoteLaser.style.left = `${xPct}%`;
      remoteLaser.style.top = `${yPct}%`;
    });

    codeEditor1.addEventListener('mouseleave', () => {
      localLaser.style.opacity = '0';
    });
  }

  // Peer 1 Chat Dispatch
  const input1 = document.getElementById('input-peer-1');
  const send1 = document.getElementById('send-peer-1');
  const stream1 = document.getElementById('chat-stream-1');
  const stream2 = document.getElementById('chat-stream-2');

  function sendFromPeer1() {
    const text = input1?.value.trim();
    if (!text) return;

    // Append to Peer 1 as Sent
    const bubbleSent = document.createElement('div');
    bubbleSent.className = 'chat-bubble sent';
    bubbleSent.innerHTML = `<span class="bubble-nick">You (Alice):</span> ${text} <span class="ack-mark">✓✓</span>`;
    stream1?.appendChild(bubbleSent);
    stream1.scrollTop = stream1.scrollHeight;
    input1.value = '';

    // Propagate to Peer 2 as Received after small simulated P2P latency
    setTimeout(() => {
      const bubbleRecv = document.createElement('div');
      bubbleRecv.className = 'chat-bubble received';
      bubbleRecv.innerHTML = `<span class="bubble-nick">Alice (Tutor):</span> ${text}`;
      stream2?.appendChild(bubbleRecv);
      stream2.scrollTop = stream2.scrollHeight;
      showToast('P2P Message received by Bob via WebRTC DataChannel!', 'message-square');
    }, 60);
  }

  send1?.addEventListener('click', sendFromPeer1);
  input1?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendFromPeer1();
  });

  // Peer 2 Chat Dispatch
  const input2 = document.getElementById('input-peer-2');
  const send2 = document.getElementById('send-peer-2');

  function sendFromPeer2() {
    const text = input2?.value.trim();
    if (!text) return;

    // Append to Peer 2 as Sent
    const bubbleSent = document.createElement('div');
    bubbleSent.className = 'chat-bubble sent';
    bubbleSent.innerHTML = `<span class="bubble-nick">You (Bob):</span> ${text} <span class="ack-mark">✓✓</span>`;
    stream2?.appendChild(bubbleSent);
    stream2.scrollTop = stream2.scrollHeight;
    input2.value = '';

    // Propagate to Peer 1 as Received
    setTimeout(() => {
      const bubbleRecv = document.createElement('div');
      bubbleRecv.className = 'chat-bubble received';
      bubbleRecv.innerHTML = `<span class="bubble-nick">Bob:</span> ${text}`;
      stream1?.appendChild(bubbleRecv);
      stream1.scrollTop = stream1.scrollHeight;
      showToast('P2P Message received by Alice!', 'message-square');
    }, 60);
  }

  send2?.addEventListener('click', sendFromPeer2);
  input2?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendFromPeer2();
  });

  // Stage Trigger
  const btnStage = document.getElementById('btn-trigger-stage');
  const bobPill = document.getElementById('bob-stage-pill');
  if (btnStage && bobPill) {
    btnStage.addEventListener('click', () => {
      bobPill.style.animation = 'pulseWire 1s 3';
      showToast('Alice broadcasted Live Screen Share stage to peers!', 'tv');
    });
  }

  // 4. Interactive Sandbox Simulator
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
      hash = hash & hash;
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
      showToast('Computed deterministic room hash!', 'sparkles');
    });

    urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        simulateRoomHash(urlInput.value.trim());
        showToast('Computed deterministic room hash!', 'sparkles');
      }
    });
  }

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetUrl = btn.getAttribute('data-url');
      if (targetUrl && urlInput) {
        urlInput.value = targetUrl;
        simulateRoomHash(targetUrl);
        showToast(`Loaded preset: ${btn.innerText.trim()}`, 'code-2');
      }
    });
  });

  if (urlInput) {
    simulateRoomHash(urlInput.value.trim());
  }

  // 5. Interactive Spoiler Demo
  const demoSpoiler = document.getElementById('demo-spoiler');
  if (demoSpoiler) {
    demoSpoiler.addEventListener('click', () => {
      demoSpoiler.classList.toggle('revealed');
    });
  }

  // 6. Interactive Setup Checklist Progress
  const checkboxes = document.querySelectorAll('.step-checkbox');
  const progressFill = document.getElementById('setup-progress-fill');
  const progressText = document.getElementById('setup-progress-text');

  function updateChecklistProgress() {
    let checked = 0;
    checkboxes.forEach((cb) => {
      const card = cb.closest('.step-card');
      if (cb.checked) {
        checked++;
        card?.classList.add('completed');
      } else {
        card?.classList.remove('completed');
      }
    });

    const pct = (checked / checkboxes.length) * 100;
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressText) {
      if (checked === checkboxes.length) {
        progressText.innerHTML = `🎉 <strong>100% Completed! You're ready to collaborate!</strong>`;
        progressText.style.color = '#34d399';
      } else {
        progressText.innerText = `${checked} / ${checkboxes.length} Steps Completed`;
        progressText.style.color = '';
      }
    }
  }

  checkboxes.forEach((cb) => {
    cb.addEventListener('change', updateChecklistProgress);
  });

  // 7. 1-Click Code Copy Snippets
  const copyBtns = document.querySelectorAll('.copy-btn');
  copyBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const textToCopy = (e.currentTarget).getAttribute('data-copy') || '';
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy);
        showToast('Copied to clipboard!', 'check');

        // Automatically mark step 2 checkbox
        const chk2 = document.getElementById('chk-step-2');
        if (chk2 && !chk2.checked) {
          chk2.checked = true;
          updateChecklistProgress();
        }
      }
    });
  });

  // 8. Download Trigger
  const downloadTriggers = document.querySelectorAll('.btn-download-trigger');
  downloadTriggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      showToast('Downloading nerd-buddy-v0.1.0.zip...', 'download');

      // Automatically mark step 1 checkbox
      const chk1 = document.getElementById('chk-step-1');
      if (chk1 && !chk1.checked) {
        chk1.checked = true;
        updateChecklistProgress();
      }
    });
  });

  // 9. FAQ Accordion Toggle
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

  // 10. Geo-Region & Timezone Localizer
  function initGeoLocation() {
    const geoRegionEl = document.getElementById('geo-detected-region');
    const geoPingEl = document.getElementById('geo-ping-val');
    const geoTimeEl = document.getElementById('geo-time-display');

    try {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      let regionName = 'Global Anycast';
      let ping = '0.6ms';

      if (timeZone.includes('America') || timeZone.includes('US')) {
        regionName = 'US-East (N. Virginia)';
        ping = '0.4ms';
      } else if (timeZone.includes('Europe') || timeZone.includes('London') || timeZone.includes('Berlin')) {
        regionName = 'EU-Central (Frankfurt)';
        ping = '0.5ms';
      } else if (timeZone.includes('Asia/Kolkata') || timeZone.includes('Calcutta') || timeZone.includes('India')) {
        regionName = 'AP-South (Mumbai)';
        ping = '0.3ms';
      } else if (timeZone.includes('Asia') || timeZone.includes('Tokyo') || timeZone.includes('Singapore')) {
        regionName = 'AP-East (Tokyo/Singapore)';
        ping = '0.5ms';
      }

      if (geoRegionEl) {
        geoRegionEl.innerHTML = `<i data-lucide="globe" class="icon-xxs"></i> Connected: <strong>${regionName}</strong>`;
      }
      if (geoPingEl) {
        geoPingEl.innerText = ping;
      }

      // Update local time
      function updateTime() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (geoTimeEl) {
          geoTimeEl.innerText = `${timeStr} (${timeZone.split('/').pop()?.replace('_', ' ') || 'Local'})`;
        }
      }
      updateTime();
      setInterval(updateTime, 1000);

      if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons({ root: geoRegionEl });
      }
    } catch (e) {
      console.warn('Geo detection error:', e);
    }
  }
  initGeoLocation();

  // 11. Multi-Language Quick Switcher
  const langSelector = document.getElementById('lang-selector');
  const translations = {
    en: {
      heroTitle: 'Code Together, <span class="text-gradient">In Real Time.</span><br>Zero Setup Required.',
      heroSub: 'Instant collaborative study rooms that form automatically the second you open any <strong>LeetCode</strong>, <strong>Codeforces</strong>, <strong>NeetCode</strong>, or <strong>HackerRank</strong> problem. Direct WebRTC screen sharing, laser pointers, and in-page chat with <strong>zero central servers between peers</strong>.',
      downloadBtn: 'Download Extension (.zip)',
      toastLang: 'Language switched to English (US)'
    },
    es: {
      heroTitle: 'Programa en equipo, <span class="text-gradient">en tiempo real.</span><br>Sin configuración previa.',
      heroSub: 'Salas de estudio colaborativas P2P instantáneas para <strong>LeetCode</strong>, <strong>Codeforces</strong> y <strong>NeetCode</strong>. Comparte pantalla, usa puntero láser y chat integrado sin servidores centrales.',
      downloadBtn: 'Descargar Extensión (.zip)',
      toastLang: 'Idioma cambiado a Español'
    },
    zh: {
      heroTitle: '实时协同刷题，<span class="text-gradient">零配置开启。</span>',
      heroSub: '打开 <strong>LeetCode（力扣）</strong>、<strong>Codeforces</strong> 或 <strong>NeetCode</strong> 时自动生成 P2P 研讨室。点对点屏幕共享、激光笔互动与实时聊天，无中心服务器中转。',
      downloadBtn: '下载扩展程序包 (.zip)',
      toastLang: '已切换为简体中文'
    },
    hi: {
      heroTitle: 'एक साथ कोड करें, <span class="text-gradient">रीयल टाइम में।</span><br>शून्य सेटअप आवश्यक।',
      heroSub: 'LeetCode, Codeforces और NeetCode पर सीधे P2P स्टडी रूम। स्क्रीन शेयर, लेजर पॉइंटर और इन-पेज चैट बिना किसी केंद्रीय सर्वर के।',
      downloadBtn: 'एक्सटेंशन डाउनलोड करें (.zip)',
      toastLang: 'भाषा हिन्दी में बदली गई'
    },
    ja: {
      heroTitle: 'リアルタイムで一緒にコーディング、<span class="text-gradient">設定不要。</span>',
      heroSub: 'LeetCodeやCodeforcesの問題を開くだけで自動的にP2Pスタディルームが立ち上がります。WebRTC画面共有、レーザーポインター、チャット完備。',
      downloadBtn: '拡張機能をダウンロード (.zip)',
      toastLang: '言語を日本語に切り替えました'
    }
  };

  if (langSelector) {
    langSelector.addEventListener('change', (e) => {
      const selected = (e.target).value;
      const dict = translations[selected] || translations.en;

      const heroHeading = document.getElementById('main-heading');
      if (heroHeading) heroHeading.innerHTML = dict.heroTitle;

      const heroSubtitle = document.querySelector('.hero-subtitle');
      if (heroSubtitle) heroSubtitle.innerHTML = dict.heroSub;

      const mainDownloadTexts = document.querySelectorAll('.btn-main-text');
      mainDownloadTexts.forEach((el) => {
        if (el.innerText.includes('Download') || el.innerText.includes('Descargar') || el.innerText.includes('下载') || el.innerText.includes('डाउनलोड') || el.innerText.includes('ダウンロード')) {
          el.innerText = dict.downloadBtn;
        }
      });

      showToast(dict.toastLang, 'globe');
    });
  }
});


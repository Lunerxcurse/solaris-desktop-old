const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]:not([aria-disabled="true"])',
  '[data-tv-focus="true"]',
  /* Explicitly include Play/Trailer buttons and common hero button classes so they participate in spatial nav */
  'button.play-hero',
  'button.trailer-hero',
  '.play-hero',
  '.trailer-hero',
  '#play-btn',
  '#trailer-btn'
].join(',');

function isVisible(el) {
  if (!el) return false;
  if (el.disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;

  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (+style.opacity === 0) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;

  // offsetParent is good enough for most pages; keep it as a fast filter.
  if (el.offsetParent === null && style.position !== 'fixed') {
    // offsetParent can be null even for some fixed elements; don't hard-fail if it's fixed.
    const pos = style.position;
    if (pos !== 'fixed' && pos !== 'sticky') return false;
  }
  return true;
}

function getFocusable() {
  const els = Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter(isVisible)
    .filter((el) => {
      // Avoid focusing elements that are inside closed menus/hidden containers
      // (display:none already filtered; this catches some edge cases).
      const hidden = el.closest('[hidden]');
      if (hidden) return false;
      return true;
    });

  // De-dupe while preserving order
  const seen = new Set();
  const out = [];
  for (const el of els) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push(el);
  }
  return out;
}

function centerOf(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function overlapAmount(a, b) {
  // returns positive overlap in Y or X depending on args being [top,bottom] like values
  const low = Math.max(a[0], b[0]);
  const high = Math.min(a[1], b[1]);
  return high - low;
}

function getScrollableParent(el, axis) {
  let p = el?.parentElement;
  while (p) {
    const style = window.getComputedStyle(p);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    const scrollSize = axis === 'x' ? p.scrollWidth : p.scrollHeight;
    const clientSize = axis === 'x' ? p.clientWidth : p.clientHeight;

    if ((overflow === 'auto' || overflow === 'scroll') && scrollSize > clientSize + 1) {
      return p;
    }
    p = p.parentElement;
  }
  return null;
}

function ensureVisible(el) {
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const tol = 10;

  const xOut = rect.left < -tol || rect.right > vw + tol;
  const yOut = rect.top < -tol || rect.bottom > vh + tol;

  let didScroll = false;

  // If we're horizontally offscreen, prefer scrolling within a row/carousel container.
  if (xOut) {
    const row = getScrollableParent(el, 'x');
    if (row) {
      const pr = row.getBoundingClientRect();
      const pad = 16;

      if (rect.left < pr.left + pad) {
        row.scrollLeft -= (pr.left + pad - rect.left);
        didScroll = true;
      } else if (rect.right > pr.right - pad) {
        row.scrollLeft += (rect.right - (pr.right - pad));
        didScroll = true;
      }
    }
  }

  // If we're vertically offscreen (or couldn't scroll a row), scroll the page to bring it into view.
  if (!didScroll && yOut) {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    didScroll = true;
  }

  // If still horizontally offscreen (no scrollable parent), fallback to browser scrolling.
  if (!didScroll && xOut) {
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  }
}

function focusEl(el) {
  ensureVisible(el);
  try {
    el.focus({ preventScroll: true });
  } catch {
    try { el.focus(); } catch {}
  }
}

function moveFocus(dir) {
  const candidates = getFocusable();
  if (!candidates.length) return false; // signal no movement possible

  const active = document.activeElement;
  let curr = candidates.includes(active) ? active : candidates[0];

  const currRect = curr.getBoundingClientRect();
  if (!currRect || (currRect.width < 1 && currRect.height < 1)) {
    curr = candidates[0];
  }

  const currRect2 = curr.getBoundingClientRect();
  const currCenter = centerOf(currRect2);

  const tolY = 48; // generous overlap tolerance for TV remotes
  const tolX = 48;

  // FIRST: direct hero-play/trailer toggles for immediate adjacency
  try {
    // If current is a hero Play button and user presses RIGHT -> focus its sibling More Info (trailer) button
    if (dir === 'right') {
      if (curr.matches && curr.matches('.play-hero')) {
        const heroSlide = curr.closest('.hero-slide');
        if (heroSlide) {
          const more = Array.from(heroSlide.querySelectorAll('.trailer-hero, .more-hero, .trailer-hero *')).find(isVisible) || heroSlide.querySelector('.trailer-hero');
          if (more) { focusEl(more); return true; }
        }
      }
    }
    // If current is a More Info / trailer button and user presses LEFT -> focus its sibling Play button
    if (dir === 'left') {
      if (curr.matches && curr.matches('.trailer-hero')) {
        const heroSlide = curr.closest('.hero-slide');
        if (heroSlide) {
          const play = Array.from(heroSlide.querySelectorAll('.play-hero, .play-hero *')).find(isVisible) || heroSlide.querySelector('.play-hero');
          if (play) { focusEl(play); return true; }
        }
      }
    }
  } catch (e) {
    // ignore and continue to other heuristics
  }

  // NEW: If moving RIGHT and current focus is inside the left sidebar, prefer hero slide Play/Trailer buttons.
  // ALSO: If moving UP and current focus is inside the Top 10 row, prefer the hero slide Play button.
  // ALSO: If moving DOWN and current focus is a hero Play/Trailer button, focus the first poster in the Top 10 row.
  try {
    if (dir === 'right') {
      const inSidebar = curr.closest && curr.closest('nav.fixed.left-0, nav.fixed.left-0 *');
      if (inSidebar) {
        // Prefer the closest visible hero Play button (or trailer) if it's within a reasonable distance;
        // otherwise fall back to the nearest poster/card in the main content.
        const playSelectors = '.hero-slide .play-hero, .hero-slide .trailer-hero, .play-hero, .trailer-hero';
        const posterSelectors = '.poster-card, .top10-poster, [data-imdb]';

        // compute center of current element
        const currR = curr.getBoundingClientRect();
        const currC = centerOf(currR);

        function nearest(elements) {
          let bestEl = null;
          let bestDist = Infinity;
          for (const el of elements) {
            if (!isVisible(el)) continue;
            const r = el.getBoundingClientRect();
            const c = centerOf(r);
            const dx = c.x - currC.x;
            const dy = c.y - currC.y;
            const dist = Math.hypot(dx, dy);
            if (dist < bestDist) {
              bestDist = dist;
              bestEl = el;
            }
          }
          return { el: bestEl, dist: bestDist };
        }

        const heroBtns = Array.from(document.querySelectorAll(playSelectors));
        const foundHero = nearest(heroBtns);

        // threshold: prefer hero button if within ~700px (adjustable)
        const HERO_THRESHOLD = 700;
        if (foundHero.el && foundHero.dist <= HERO_THRESHOLD) {
          focusEl(foundHero.el);
          return true;
        }

        // if no nearby hero button, try nearest poster/card
        const posters = Array.from(document.querySelectorAll(posterSelectors));
        const foundPoster = nearest(posters);
        if (foundPoster.el) {
          focusEl(foundPoster.el);
          return true;
        }

        // final fallback: hero dots or first hero button if nothing else
        if (heroBtns.length) {
          focusEl(heroBtns[0]);
          return true;
        }
        const heroDots = Array.from(document.querySelectorAll('#hero-dots button')).filter(isVisible);
        if (heroDots.length) {
          focusEl(heroDots[0]);
          return true;
        }
      }
    }

    if (dir === 'up') {
      // If current focus is inside the Top 10 row, move focus to the hero slide Play button.
      const inTop10 = curr.closest && (curr.closest('#top-10-row') || curr.closest('.top10-item') || curr.closest('[id^="top-10"]'));
      if (inTop10) {
        // Prefer the visible hero slide's play button
        const visibleHeroPlay = Array.from(document.querySelectorAll('.hero-slide'))
          .filter(s => s.style && (s.style.opacity === '1' || window.getComputedStyle(s).opacity === '1'))
          .flatMap(s => Array.from(s.querySelectorAll('.play-hero, .play-hero .btn-label, .play-hero')));
        const heroBtns = visibleHeroPlay.length ? visibleHeroPlay.filter(isVisible) : Array.from(document.querySelectorAll('.hero-slide .play-hero, .play-hero')).filter(isVisible);
        if (heroBtns.length) {
          focusEl(heroBtns[0]);
          return true;
        }
        // fallback: focus a global play button if present
        const globalPlay = Array.from(document.querySelectorAll('#play-btn, .play-hero')).filter(isVisible);
        if (globalPlay.length) {
          focusEl(globalPlay[0]);
          return true;
        }
      }
    }

    if (dir === 'down') {
      // If current focus is on a hero Play or Trailer button, jump to first poster in Top 10 row.
      const isHeroBtn = curr.matches && (curr.matches('.play-hero') || curr.matches('.trailer-hero') || curr.closest('.hero-slide'));
      if (isHeroBtn) {
        const top10First = Array.from(document.querySelectorAll('#top-10-row .poster-card, #top-10-row .top10-poster, #top-10-row [data-imdb]'))
          .filter(isVisible)[0];
        if (top10First) {
          focusEl(top10First);
          return true;
        }
      }
    }
  } catch (e) {
    // ignore and continue to normal selection
  }

  let best = null;
  let bestScore = Infinity;

  // If the current element sits inside a horizontal scrollable row, capture that row.
  const horizRow = getScrollableParent(curr, 'x');

  const passStrict = (rect, el) => {
    // If we're moving left and we're inside a horizontally scrollable row that is not scrolled fully left,
    // disallow candidates that are outside the same row so we don't jump to the sidebar prematurely.
    if (dir === 'left' && horizRow && horizRow.scrollLeft > 1) {
      if (!el.closest) return false;
      const candidateRow = el.closest ? el.closest(horizRow.tagName.toLowerCase() + (horizRow.id ? `#${horizRow.id}` : '')) : null;
      // If candidate isn't inside the same scrollable container, treat it as not a strict candidate.
      if (!candidateRow) return false;
    }

    if (dir === 'right') {
      const yOk = overlapAmount([rect.top, rect.bottom], [currRect2.top, currRect2.bottom]) >= -tolY;
      const xOk = rect.left >= currRect2.right - 2;
      return yOk && xOk;
    }
    if (dir === 'left') {
      const yOk = overlapAmount([rect.top, rect.bottom], [currRect2.top, currRect2.bottom]) >= -tolY;
      const xOk = rect.right <= currRect2.left + 2;
      return yOk && xOk;
    }
    if (dir === 'down') {
      const xOk = overlapAmount([rect.left, rect.right], [currRect2.left, currRect2.right]) >= -tolX;
      const yOk = rect.top >= currRect2.bottom - 2;
      return xOk && yOk;
    }
    // up
    {
      const xOk = overlapAmount([rect.left, rect.right], [currRect2.left, currRect2.right]) >= -tolX;
      const yOk = rect.bottom <= currRect2.top + 2;
      return xOk && yOk;
    }
  };

  const scoreCandidate = (rect, el) => {
    const c = centerOf(rect);
    const dx = c.x - currCenter.x;
    const dy = c.y - currCenter.y;

    // If a horizRow exists and the candidate is inside it, slightly prefer it when moving left/right.
    let rowBias = 0;
    if (horizRow && el && horizRow.contains(el)) {
      rowBias = -8; // small negative bias reduces the score (preferred)
    }

    // Directional bias: prefer minimal distance in the intended axis, with overlap in the perpendicular axis.
    if (dir === 'right') {
      return (dx * dx) * 0.9 + (Math.max(0, currRect2.right - rect.left) * 10) + (dy * dy) * 0.15 + rowBias;
    }
    if (dir === 'left') {
      return (dx * dx) * 0.9 + (Math.max(0, rect.right - currRect2.left) * 10) + (dy * dy) * 0.15 + rowBias;
    }
    if (dir === 'down') {
      return (dy * dy) * 0.9 + (Math.max(0, currRect2.bottom - rect.top) * 10) + (dx * dx) * 0.15 + rowBias;
    }
    // up
    return (dy * dy) * 0.9 + (Math.max(0, rect.bottom - currRect2.top) * 10) + (dx * dx) * 0.15 + rowBias;
  };

  // First pass: strict directional + overlap tolerance
  for (const el of candidates) {
    if (el === curr) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (!passStrict(r, el)) continue;

    const s = scoreCandidate(r, el);
    if (s < bestScore) {
      bestScore = s;
      best = el;
    }
  }

  // Second pass: relaxed (any element in that half-plane), still with scoring.
  // However, when moving left and we have a horizRow not scrolled to its left edge, avoid candidates outside that row.
  if (!best) {
    for (const el of candidates) {
      if (el === curr) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      const c = centerOf(r);
      if (dir === 'right' && c.x < currCenter.x) continue;
      if (dir === 'left' && c.x > currCenter.x) continue;
      if (dir === 'down' && c.y < currCenter.y) continue;
      if (dir === 'up' && c.y > currCenter.y) continue;

      // if we are moving left and inside a horizontally scrollable row that hasn't been scrolled to start,
      // skip candidates that are not inside that same row to avoid jumping to sidebar early.
      if (dir === 'left' && horizRow && horizRow.scrollLeft > 1) {
        if (!horizRow.contains(el)) continue;
      }

      const s = scoreCandidate(r, el);
      if (s < bestScore) {
        bestScore = s;
        best = el;
      }
    }
  }

  if (best) {
    focusEl(best);
    return true; // moved focus successfully
  }
  return false; // no suitable candidate found
}

function shouldIgnoreForInput(activeEl) {
  if (!activeEl) return true;
  const tag = activeEl.tagName ? activeEl.tagName.toUpperCase() : '';
  if (activeEl.isContentEditable) return true;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

function initTvSpatialNavigation() {
  // Ensure visible focus for TV remote usage.
  const style = document.createElement('style');
  style.textContent = `
    :focus { outline: none; }
    :focus-visible {
      outline: 2px solid rgba(173,199,255,0.95) !important;
      outline-offset: 2px !important;
      border-radius: 8px;
    }
  `;
  document.head.appendChild(style);

  let raf = 0;
  window.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const activeEl = document.activeElement;
    if (shouldIgnoreForInput(activeEl)) return;

    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const dir =
        e.key === 'ArrowRight' ? 'right' :
        e.key === 'ArrowLeft' ? 'left' :
        e.key === 'ArrowDown' ? 'down' : 'up';

      // attempt to move focus; if moveFocus returns false (no candidate moved),
      // fall back to scrolling vertically for up/down or horizontally for left/right.
      const moved = moveFocus(dir);

      if (!moved) {
        // behavior: on up/down arrow when nothing focusable nearby -> scroll page
        // on left/right arrow when nothing -> try small horizontal scroll for scrollable rows
        try {
          if (dir === 'down') {
            window.scrollBy({ top: Math.max(200, window.innerHeight * 0.25), left: 0, behavior: 'smooth' });
          } else if (dir === 'up') {
            window.scrollBy({ top: -Math.max(200, window.innerHeight * 0.25), left: 0, behavior: 'smooth' });
          } else if (dir === 'right') {
            // try to scroll any row that contains the primary focus or viewport center
            const centerEl = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
            const row = getScrollableParent(centerEl || document.body, 'x') || getScrollableParent(document.activeElement || document.body, 'x');
            if (row) row.scrollBy({ left: Math.max(160, row.clientWidth * 0.25), behavior: 'smooth' });
            else window.scrollBy({ left: Math.max(160, window.innerWidth * 0.25), top: 0, behavior: 'smooth' });
          } else if (dir === 'left') {
            // Try to scroll any horizontal row first
            const centerEl = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
            const row = getScrollableParent(centerEl || document.body, 'x') || getScrollableParent(document.activeElement || document.body, 'x');
            if (row) {
              row.scrollBy({ left: -Math.max(160, row.clientWidth * 0.25), behavior: 'smooth' });
            } else {
              // If there is nothing to scroll and we're on the homepage, focus the Home button for quick access
              const homeBtn = document.querySelector('#sidebar-home');
              if (homeBtn && window.location.pathname && (window.location.pathname.endsWith('/index.html') || window.location.pathname === '/' || window.location.pathname === '')) {
                try { focusEl(homeBtn); return; } catch (e) {}
              }
              // fallback horizontal scroll of the page
              window.scrollBy({ left: -Math.max(160, window.innerWidth * 0.25), top: 0, behavior: 'smooth' });
            }
          }
        } catch (err) {
          // swallow any scroll errors
        }
      }
    });
  });

  // Give an initial focus if none exists yet (helps first remote press).
  setTimeout(() => {
    const activeEl = document.activeElement;
    if (activeEl && activeEl !== document.body && activeEl !== document.documentElement) return;

    const candidates = getFocusable();
    if (candidates.length) focusEl(candidates[0]);
  }, 50);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTvSpatialNavigation);
} else {
  initTvSpatialNavigation();
}

// Remote "Back" handling: open last details on index.html when user presses back on remote
(function(){
  function isInputFocused(){
    const a = document.activeElement;
    if(!a) return false;
    const t = (a.tagName || '').toUpperCase();
    if(t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
    if(a.isContentEditable) return true;
    return false;
  }

  window.addEventListener('keydown', (e) => {
    // common remote back keys: BrowserBack, Backspace, Escape; ignore when typing
    if(isInputFocused()) return;
    const backKeys = ['BrowserBack','Backspace','Escape','SoftLeft','MediaBack'];
    if(!backKeys.includes(e.key)) return;
    try {
      const raw = localStorage.getItem('last_opened_tmdb');
      if(!raw) return;
      const obj = JSON.parse(raw);
      if(!obj || !obj.id) return;
      // build deep-link to open details on index.html
      const type = encodeURIComponent((obj.type || 'movie').toString().toLowerCase() === 'series' ? 'tv' : (obj.type || 'movie'));
      const id = encodeURIComponent(String(obj.id));
      // navigate to index.html with tmdb query so index.js will open details
      const target = `/index.html?tmdb=${id}&type=${type}`;
      // if already on index but different params, replace; otherwise navigate
      if(location.pathname.endsWith('/index.html') || location.pathname === '/' || location.pathname.endsWith('/')) {
        // use replace/assign depending on current params
        if(location.search.indexOf('tmdb=') === -1 || location.search.indexOf(`tmdb=${id}`) === -1) {
          location.href = target;
        } else {
          // already showing same; no-op
        }
      } else {
        location.href = target;
      }
    } catch (err) {
      // ignore errors
      console.warn('back handler failed', err);
    }
  });
})();
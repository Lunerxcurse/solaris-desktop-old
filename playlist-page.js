<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>playlist-page.js (module)</title>
</head>
<body>
<script>
/*
  Extracted utilities for parsing M3U playlists and rendering the standalone playlist
  page HTML. These functions were previously in app.js and are now exposed on window
  so other scripts can call them after this file is loaded.
*/

(function(){
  // parseM3uToArray: parse an M3U string into an array of channel objects
  function parseM3uToArray(m3uContent) {
    const lines = m3uContent.trim().split('\n');
    const out = [];
    let current = null;
    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      if (l.startsWith('#EXTINF:')) {
        const info = l.substring(8).trim();
        const tvgLogoMatch = info.match(/tvg-logo="([^"]*)"/);
        const groupTitleMatch = info.match(/group-title="([^"]*)"/);
        const nameMatch = info.match(/,(.*)/);
        current = {
          logo: tvgLogoMatch ? tvgLogoMatch[1] : 'placeholder.png',
          group: groupTitleMatch ? groupTitleMatch[1] : 'General',
          name: nameMatch ? nameMatch[1].trim() : 'Unknown Channel',
          url: ''
        };
      } else if (!l.startsWith('#')) {
        if (current) {
          current.url = l;
          out.push(current);
          current = null;
        }
      }
    }
    return out;
  }

  // renderPlaylistPageHTML: returns full HTML for a playlist page (string)
  function renderPlaylistPageHTML(channelsJSON) {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Channels - Playlist</title>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<style>
body{font-family:system-ui,Segoe UI,Arial;background:#0A0A0A;color:#e5e2e1;margin:0;padding:16px}
.back-btn{position:fixed;left:16px;top:16px;z-index:999;background:transparent;border-radius:9999px;padding:8px;border:1px solid rgba(255,255,255,0.04);color:#a78bfa;cursor:pointer}
.header{display:flex;align-items:center;gap:12px;margin-bottom:12px;padding-left:56px}
.container{display:flex;gap:20px;align-items:stretch;max-width:1400px;margin:0 auto}
.left-column{width:min(46%,520px);min-width:280px;position:sticky;top:88px;align-self:flex-start;height:calc(100vh - 120px);overflow:auto;display:flex;flex-direction:column;gap:12px;padding-right:8px;}
.right-column{flex:1;display:flex;flex-direction:column;gap:12px;align-items:stretch;}
.channel-card{display:flex;align-items:center;gap:12px;padding:8px;border:1px solid rgba(255,255,255,0.04);border-radius:8px;margin-bottom:8px;cursor:pointer}
.channel-card:hover{background:rgba(255,255,255,0.02)}
.logo{width:64px;height:40px;object-fit:contain;border-radius:4px;background:#000}
.player{width:100%;max-width:960px;aspect-ratio:16/9;max-height:540px;background:#000;border-radius:8px;overflow:hidden;margin:0 auto}
.controls{display:flex;gap:8px;align-items:center;margin-bottom:12px}
.filter{padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:#0F0F10;color:#e5e2e1;flex:1}
</style>
</head>
<body>
<button class="back-btn" onclick="location.replace('/live-tv.html')" aria-label="Back" title="Back">
  <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 0;">arrow_back</span>
</button>
<div class="header">
<h1 style="margin:0;font-size:18px">Channels</h1>
</div>

<div class="container">
  <aside class="left-column" id="left-column">
    <div style="display:flex;align-items:center;gap:12px;">
      <h2 id="playlist-title" style="margin:0;font-size:18px;flex:0 0 auto;">${channelsJSON ? channelsJSON : 'Channels'}</h2>
      <div id="playlist-count" style="margin-left:auto;color:#9ca3af;font-size:13px"></div>
    </div>

    <div style="display:flex;gap:8px;align-items:center;">
      <input id="filter" placeholder="Search Channels" style="flex:1;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:#0F0F10;color:#e5e2e1;">
    </div>

    <div id="list" style="margin-top:8px;display:flex;flex-direction:column;gap:8px;"></div>
  </aside>

  <section class="right-column" id="player-column">
    <div id="playlist-player-wrap" class="player" data-tv-focus="true" tabindex="0" role="button">
      <div id="playlist-video" style="width:100%;height:100%;background:#000;display:block">
        <video playsinline style="width:100%;height:100%;object-fit:contain;background:#000;"></video>
      </div>
      <div id="player-placeholder" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000;color:#9ca3af;font-size:14px;">
        <span id="player-placeholder-text">Select a channel to start playback</span>
      </div>
    </div>

    <div id="playlist-controls" style="display:flex;gap:12px;align-items:center;">
      <div id="current-channel-info" style="flex:1;color:#e5e2e1;font-size:14px;"></div>
      <div style="color:#9ca3af;font-size:13px">HD</div>
    </div>
  </section>
</div>

<script>
/* Lightweight client-side wiring for the generated page (keeps behavior similar to original).
   This script expects the page to be loaded as a full document generated by renderPlaylistPageHTML.
*/
(function(){
  try{
    const rawChannels = ${channelsJSON || '[]'};
    const channels = Array.isArray(rawChannels) ? rawChannels : (function(){ try { return JSON.parse(String(rawChannels)); } catch(e){ return []; } })();
    const list = document.getElementById('list');
    const filter = document.getElementById('filter');
    const vid = document.querySelector('#playlist-video video');

    function buildCard(c){
      const card = document.createElement('div');
      card.className = 'channel-card';
      card.tabIndex = 0;
      card.innerHTML = '<img class="logo" src="'+(c.logo||'')+'" onerror="this.style.display=\\'none\\'"><div style="flex:1"><div style="font-weight:600">'+(c.name||'')+'</div><div style="font-size:12px;color:#9ca3af">'+(c.group||'')+'</div></div><div style="font-size:14px;color:#9ca3af">▶</div>';
      card.addEventListener('click', async () => {
        try { document.getElementById('player-placeholder').style.display = 'none'; } catch(e){}
        if(c.url.toLowerCase().endsWith('.m3u8') && window.Hls && Hls.isSupported()){
          if(window._hlsInst){ window._hlsInst.destroy(); window._hlsInst = null; }
          window._hlsInst = new Hls();
          window._hlsInst.loadSource(c.url);
          window._hlsInst.attachMedia(vid);
          window._hlsInst.on(Hls.Events.MANIFEST_PARSED, ()=> vid.play().catch(()=>{}));
        } else {
          if(window._hlsInst){ window._hlsInst.destroy(); window._hlsInst = null; }
          vid.src = c.url;
          try { await vid.play(); } catch(e){}
        }
      });
      return card;
    }

    function renderList(items){
      list.innerHTML = '';
      if(!items || items.length === 0){
        list.innerHTML = '<div id="playlist-empty" style="color:#9ca3af;padding:12px;text-align:center">No channels</div>';
        return;
      }
      items.forEach(c => list.appendChild(buildCard(c)));
    }

    renderList(channels);

    filter.addEventListener('input', ()=>{
      const q = filter.value.toLowerCase().trim();
      if(!q) return renderList(channels);
      renderList((channels||[]).filter(c => (c.name||'').toLowerCase().includes(q) || (c.group||'').toLowerCase().includes(q)));
    });

    if(!window.Hls){
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
      s.onload = ()=> console.log('Hls.js loaded');
      s.onerror = ()=> console.warn('Hls.js failed to load');
      document.head.appendChild(s);
    }
  }catch(e){ console.warn('playlist page client init failed', e); }
})();
</script>
</body>
</html>`;
  }

  // expose on window
  window.parseM3uToArray = parseM3uToArray;
  window.renderPlaylistPageHTML = renderPlaylistPageHTML;
})();
</script>
</body>
</html>
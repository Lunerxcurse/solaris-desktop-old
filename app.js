document.addEventListener('DOMContentLoaded', () => {
    const m3uUrlInput = document.getElementById('m3u-url');
    const loadUrlBtn = document.getElementById('load-url-btn');
    const m3uFileInput = document.getElementById('m3u-file');
    const channelList = document.getElementById('channel-list');
    const videoPlayer = document.getElementById('video-player');
    const playerPlaceholder = document.getElementById('player-placeholder');
    const currentChannelInfo = document.getElementById('current-channel-info');
    const searchBar = document.getElementById('search-bar');

    let hls = null;
    let channels = [];
    let currentChannel = null;

    function loadFromUrl() {
        const url = m3uUrlInput.value;
        if (!url) {
            alert('Please enter a valid M3U playlist URL.');
            return;
        }
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.text();
            })
            .then(parseM3u)
            .catch(error => alert(`Failed to load playlist from URL: ${error.message}`));
    }

    function loadFromFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => parseM3u(e.target.result);
        reader.onerror = () => alert('Error reading file.');
        reader.readAsText(file);
    }

    function parseM3u(m3uContent) {
        if (!m3uContent.startsWith('#EXTM3U')) {
            alert('Invalid M3U playlist format.');
            return;
        }

        const lines = m3uContent.trim().split('\n');
        channels = [];
        let currentChannelData = {};

        for (const line of lines) {
            if (line.startsWith('#EXTINF:')) {
                const info = line.substring(8).trim();
                const tvgIdMatch = info.match(/tvg-id="([^"]*)"/);
                const tvgLogoMatch = info.match(/tvg-logo="([^"]*)"/);
                const groupTitleMatch = info.match(/group-title="([^"]*)"/);
                const nameMatch = info.match(/,(.*)/);

                currentChannelData = {
                    tvgId: tvgIdMatch ? tvgIdMatch[1] : null,
                    logo: tvgLogoMatch ? tvgLogoMatch[1] : 'placeholder.png',
                    group: groupTitleMatch ? groupTitleMatch[1] : 'General',
                    name: nameMatch ? nameMatch[1].trim() : 'Unknown Channel',
                };
            } else if (line.trim() && !line.startsWith('#')) {
                currentChannelData.url = line.trim();
                channels.push(currentChannelData);
                currentChannelData = {};
            }
        }
        
        if (channels.length > 0) {
            renderChannelList(channels);
        } else {
            if (channelList) channelList.innerHTML = '<div class="list-group-item">No channels found in the playlist.</div>';
        }
    }

    function renderChannelList(channelsToRender) {
        if (!channelList) return;
        channelList.innerHTML = '';
        if (channelsToRender.length === 0) {
            channelList.innerHTML = '<div class="list-group-item">No channels match your search.</div>';
            return;
        }

        channelsToRender.forEach((channel, index) => {
            const listItem = document.createElement('a');
            listItem.href = '#';
            listItem.className = 'list-group-item list-group-item-action d-flex align-items-center';
            listItem.dataset.index = channels.indexOf(channel);
            
            const isVOD = channel.url.toLowerCase().endsWith('.mp4') || channel.url.toLowerCase().endsWith('.mkv');

            listItem.innerHTML = `
                <img src="${channel.logo || 'placeholder.png'}" class="channel-logo" onerror="this.src='placeholder.png'; this.onerror=null;">
                <span class="channel-name">${channel.name}</span>
                ${isVOD ? `<a href="${channel.url}" download class="btn btn-sm btn-success download-btn" onclick="event.stopPropagation();">Download</a>` : ''}
            `;

            listItem.addEventListener('click', (e) => {
                e.preventDefault();
                playChannel(channel);
                document.querySelectorAll('.list-group-item').forEach(item => item.classList.remove('active'));
                listItem.classList.add('active');
            });
            channelList.appendChild(listItem);
        });
    }

    function playChannel(channel) {
        if (!videoPlayer || !playerPlaceholder) return;
        currentChannel = channel;
        playerPlaceholder.style.display = 'none';
        videoPlayer.style.display = 'block';

        if (hls) {
            hls.destroy();
        }

        const isHls = channel.url.toLowerCase().endsWith('.m3u8');

        if (isHls && window.Hls && Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(channel.url);
            hls.attachMedia(videoPlayer);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                videoPlayer.play();
            });
             hls.on(Hls.Events.ERROR, function (event, data) {
                console.error('HLS.js error:', data);
             });
        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl') || !isHls) {
            videoPlayer.src = channel.url;
            videoPlayer.addEventListener('loadedmetadata', () => {
                videoPlayer.play();
            });
        } else {
             alert("Sorry, your browser doesn't support this stream format.");
        }
        
        updateChannelInfo();
    }
    
    function updateChannelInfo() {
        if(!currentChannelInfo) return;
        if(currentChannel) {
            currentChannelInfo.innerHTML = `
                <h5>${currentChannel.name}</h5>
                <p class="mb-0 text-muted">Group: ${currentChannel.group}</p>
            `;
        } else {
            currentChannelInfo.innerHTML = '';
        }
    }
    
    function filterChannels() {
        if (!searchBar) return;
        const query = searchBar.value.toLowerCase();
        if (!query) {
            renderChannelList(channels);
            return;
        }
        const filteredChannels = channels.filter(c => c.name.toLowerCase().includes(query) || c.group.toLowerCase().includes(query));
        renderChannelList(filteredChannels);
    }

    loadUrlBtn?.addEventListener('click', loadFromUrl);
    m3uFileInput?.addEventListener('change', loadFromFile);
    searchBar?.addEventListener('input', filterChannels);

    // --- NEW: intercept clicks on the American Channels card/link and show a parsed M3U playlist in a new tab ---
    (function attachAmerHandler() {
        try {
            const amerHref = 'https://iptv-org.github.io/iptv/regions/amer.m3u';
            // Find anchors linking to the M3U (live-tv page cards use direct hrefs)
            document.querySelectorAll(`a[href="${amerHref}"]`).forEach(a => {
                a.addEventListener('click', async (ev) => {
                    ev.preventDefault();
                    const url = amerHref;
                    try {
                        const resp = await fetch(url);
                        if (!resp.ok) throw new Error('Failed to fetch playlist');
                        const text = await resp.text();
                        // parse into lightweight channel array
                        const parsed = parseM3uToArray(text);
                        // open the playlist in the current tab by replacing the document with the generated UI
                        try {
                          // Use same-tab write to render the playlist page inside the site (avoids popups)
                          const safeJSON = JSON.stringify(parsed).replace(/</g,'\\u003c');
                          // Replace current document contents with playlist UI
                          document.open();
                          document.write(renderPlaylistPageHTML(safeJSON));
                          document.close();
                        } catch (writeErr) {
                          // fallback: attempt to navigate to a blank page then write there
                          const win = window.open('', '_self');
                          if (!win) {
                            alert('Unable to open playlist in-page.');
                            return;
                          }
                          const safeJSON = JSON.stringify(parsed).replace(/</g,'\\u003c');
                          win.document.write(renderPlaylistPageHTML(safeJSON));
                          win.document.close();
                        }
                    } catch (err) {
                        console.error(err);
                        alert('Failed to load American channels playlist.');
                    }
                });
            });
        } catch (e) {
            // silent
            console.warn('attachAmerHandler error', e);
        }
    })();

    // removed function parseM3uToArray() {} -- moved to /playlist-page.js
    // NOTE: playlist parsing now lives in /playlist-page.js; ensure that script is loaded when calling parse helpers.
    (function ensurePlaylistPageModule(){
      if (window.parseM3uToArray) return;
      const src = '/playlist-page.js';
      if (document.querySelector(`script[src="${src}"]`)) return;
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.onload = () => console.info('playlist-page.js loaded');
      s.onerror = () => console.warn('Failed to load playlist-page.js');
      document.head.appendChild(s);
    })();

    // render a standalone page HTML (opened in new tab) that displays channels and a basic player
    function renderPlaylistPageHTML(channelsJSON) {
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>American Channels - Playlist</title>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
<style>
body{font-family:system-ui,Segoe UI,Arial;background:#0A0A0A;color:#e5e2e1;margin:0;padding:16px}
.back-btn{position:fixed;left:16px;top:16px;z-index:999;background:transparent;border-radius:9999px;padding:8px;border:1px solid rgba(255,255,255,0.04);color:#a78bfa;cursor:pointer}
.header{display:flex;align-items:center;gap:12px;margin-bottom:12px;padding-left:56px}
/* layout split: left = fixed/sticky list with its own scrolling; right = player area independent */
.container{display:flex;gap:20px;align-items:stretch;max-width:1400px;margin:0 auto}
.left-column{
  width:min(46%,520px);
  min-width:280px;
  position:sticky;
  top:88px; /* keep below header/back controls */
  align-self:flex-start;
  height:calc(100vh - 120px); /* independent fixed viewport-height based size */
  overflow:auto;
  display:flex;
  flex-direction:column;
  gap:12px;
  padding-right:8px;
}
.right-column{flex:1;display:flex;flex-direction:column;gap:12px;align-items:stretch;}
.channel-card{display:flex;align-items:center;gap:12px;padding:8px;border:1px solid rgba(255,255,255,0.04);border-radius:8px;margin-bottom:8px;cursor:pointer}
.channel-card:hover{background:rgba(255,255,255,0.02)}
.logo{width:64px;height:40px;object-fit:contain;border-radius:4px;background:#000}
.player{width:100%;max-width:960px;aspect-ratio:16/9;max-height:540px;background:#000;border-radius:8px;overflow:hidden;margin:0 auto}
.controls{display:flex;gap:8px;align-items:center;margin-bottom:12px}
.filter{padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.04);background:#0F0F10;color:#e5e2e1;flex:1}
.material-symbols-outlined{font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;}
</style>
</head>
<body>
<button class="back-btn" onclick="location.replace('/live-tv.html')" aria-label="Back" title="Back">
  <span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 0;">arrow_back</span>
</button>
<div class="header">
<h1 style="margin:0;font-size:18px">American Channels</h1>
</div>

<div class="container">
  <!-- LEFT: channel list (sticky, viewport-constrained, independent scroll) -->
  <aside class="left-column" id="left-column">
    <div style="display:flex;align-items:center;gap:12px;">
      <h2 id="playlist-title" style="margin:0;font-size:18px;flex:0 0 auto;">Channels</h2>
      <div id="playlist-count" style="margin-left:auto;color:#9ca3af;font-size:13px">${channelsJSON ? JSON.parse(channelsJSON).length : '0'} channels</div>
    </div>

    <div style="display:flex;gap:8px;align-items:center;">
      <input id="filter" placeholder="Search Channels" style="flex:1;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:#0F0F10;color:#e5e2e1;">
    </div>

    <div id="list" style="margin-top:8px;display:flex;flex-direction:column;gap:8px;"></div>
  </aside>

  <!-- RIGHT: player area (independent sizing; can change without affecting left) -->
  <section class="right-column" id="player-column">
    <div id="playlist-player-wrap" class="player" aria-hidden="false" data-tv-focus="true" tabindex="0" role="button">
      <div id="playlist-video" style="width:100%;height:100%;background:#000;display:block">
        <video-player>
          <video-minimal-skin>
            <video src="https://stream.mux.com/BV3YZtogl89mg9VcNBhhnHm02Y34zI1nlMuMQfAbl3dM/highest.mp4" playsinline style="width:100%;height:100%;object-fit:contain;background:#000;"></video>
          </video-minimal-skin>
        </video-player>
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
const channels = ${channelsJSON};
const list = document.getElementById('list');
// reference to the minimal player's inner video element after it's upgraded
function getPlayerVideo(){
  const vp = document.querySelector('video-player video');
  return vp || document.querySelector('video');
}
const filter = document.getElementById('filter');
function render(chs){
    list.innerHTML='';
    chs.forEach((c, idx) => {
        const a = document.createElement('div');
        a.className='channel-card';
        a.tabIndex = 0;
        a.setAttribute('role','button');
        a.innerHTML = '<img class="logo" src="'+(c.logo||'')+'" onerror="this.style.display=\\'none\\'"><div style="flex:1"><div style="font-weight:600">'+c.name+'</div><div style="font-size:12px;color:#9ca3af">'+c.group+'</div></div><div style="font-size:14px;color:#9ca3af">▶</div>';
        const clickHandler = async () => {
            const vid = getPlayerVideo();
            if(!vid) return;
            try{ vid.pause(); }catch(e){}
            if(c.url.toLowerCase().endsWith('.m3u8') && window.Hls && Hls.isSupported()){
                if(window._hlsInst){ window._hlsInst.destroy(); window._hlsInst = null; }
                window._hlsInst = new Hls();
                window._hlsInst.loadSource(c.url);
                window._hlsInst.attachMedia(vid);
                window._hlsInst.on(Hls.Events.MANIFEST_PARSED, ()=> vid.play().catch(()=>{}));
            } else {
                if(window._hlsInst){ window._hlsInst.destroy(); window._hlsInst = null; }
                vid.src = c.url;
                try{ await vid.play(); }catch(e){}
            }
            // hide placeholder and show video element
            try { document.getElementById('player-placeholder').style.display = 'none'; } catch(e){}
            try { const v = getPlayerVideo(); if(v) v.style.display = 'block'; } catch(e){}
        };
        a.addEventListener('click', clickHandler);
        a.addEventListener('keydown', (e) => {
          if(e.key === 'Enter' || e.key === ' '){
            e.preventDefault();
            clickHandler();
          }
        });
        list.appendChild(a);
    });
}
render(channels || []);

// filtering operates only on the left list, leaving player unaffected
filter.addEventListener('input', () => {
    const q = filter.value.toLowerCase().trim();
    if(!q) return render(channels);
    render((channels || []).filter(c => (c.name||'').toLowerCase().includes(q) || (c.group||'').toLowerCase().includes(q)));
});

// Try to load Hls.js from CDN if needed
(function ensureHls(){
    if(window.Hls) return;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
    s.onload = ()=> console.log('Hls loaded');
    s.onerror = ()=> console.warn('Hls failed to load');
    document.head.appendChild(s);
})();
</script>
</body>
</html>`;
    }
});


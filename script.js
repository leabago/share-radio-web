(function () {
    'use strict';

    // API address comes from config.js (generated from the API_BASE env var in Docker).
    const config = window.RADIOWAVE_CONFIG || {};
    const API_BASE = (config.apiBase || 'http://localhost:8080').replace(/\/+$/, '');
    const CACHE_KEY_GENRES = 'radiowave_genres';
    const CACHE_KEY_LANGUAGES = 'radiowave_languages';
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
    const LIMIT = 12;
    const URL_CHECK_TIMEOUT = 15000;

    const ICON_PLAY = '<i class="bi bi-play-fill"></i>';
    const ICON_PAUSE = '<i class="bi bi-pause-fill"></i>';
    const IMAGE_PLACEHOLDER = '<i class="bi bi-image placeholder-icon"></i>';

    const FALLBACK_GENRES = [
        { id: 'rock-id', name: 'rock' },
        { id: 'pop-id', name: 'pop' },
        { id: 'jazz-id', name: 'jazz' },
        { id: 'classical-id', name: 'classical' },
        { id: 'electronic-id', name: 'electronic' },
        { id: 'talk-id', name: 'talk' },
        { id: 'indie-id', name: 'indie' },
        { id: 'ambient-id', name: 'ambient' },
        { id: 'folk-id', name: 'folk' },
    ];
    const FALLBACK_LANGUAGES = [
        { id: 'en-id', name: 'English' },
        { id: 'ru-id', name: 'Russian' },
        { id: 'fr-id', name: 'French' },
        { id: 'de-id', name: 'German' },
        { id: 'es-id', name: 'Spanish' },
        { id: 'ja-id', name: 'Japanese' },
    ];

    // ---- Session management ----
    function getOrCreateSessionId() {
        let sessionId = null;
        try { sessionId = localStorage.getItem('radioSession'); } catch (e) { /* storage blocked */ }
        if (!sessionId) {
            sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
            try { localStorage.setItem('radioSession', sessionId); } catch (e) { /* storage blocked */ }
        }
        return sessionId;
    }

    const SESSION_ID = getOrCreateSessionId();

    // ---- state ----
    let currentStationId = null;
    let audioElement = null;
    let isPlaying = false;

    // Home page state
    let homeStations = [];
    let homePage = 0;
    let homeTotal = 0;
    let homeFilter = 'famous';
    let homeRequestSeq = 0;

    // Search page state
    let searchPageNum = 0;
    let searchResults = [];
    let searchTotal = 0;
    let searchRequestSeq = 0;

    // URL validation state
    let validatedUrl = null;
    let urlValid = false;
    let validationSeq = 0;
    let urlCheckTimeout = null;

    let submitting = false;

    let genres = [];
    let languages = [];
    let genreMap = {};

    // DOM refs
    const mainPage = document.getElementById('mainPage');
    const searchPage = document.getElementById('searchPage');
    const mainPageLink = document.getElementById('mainPageLink');
    const searchPageLink = document.getElementById('searchPageLink');

    const grid = document.getElementById('stationGrid');
    const searchGrid = document.getElementById('searchStationGrid');
    const searchInput = document.getElementById('searchInput');
    const genreFilter = document.getElementById('genreFilter');
    const languageFilter = document.getElementById('languageFilter');
    const searchBtn = document.getElementById('searchBtn');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    const prevPageItem = document.getElementById('prevPageItem');
    const nextPageItem = document.getElementById('nextPageItem');

    const searchPrevBtn = document.getElementById('searchPrevBtn');
    const searchNextBtn = document.getElementById('searchNextBtn');
    const searchPageInfo = document.getElementById('searchPageInfo');
    const searchPrevPage = document.getElementById('searchPrevPage');
    const searchNextPage = document.getElementById('searchNextPage');

    const currentStationName = document.getElementById('currentStationName');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const submitStationBtn = document.getElementById('submitStationBtn');
    const checkUrlBtn = document.getElementById('checkUrlBtn');
    const pasteUrlBtn = document.getElementById('pasteUrlBtn');
    const urlStatus = document.getElementById('urlStatus');

    // Add station modal fields
    const addStationModal = document.getElementById('addStationModal');
    const stationNameInput = document.getElementById('stationNameInput');
    const stationUrlInput = document.getElementById('stationUrlInput');
    const stationGenreSelect = document.getElementById('stationGenreSelect');
    const stationLanguageSelect = document.getElementById('stationLanguageSelect');
    const stationDescriptionInput = document.getElementById('stationDescriptionInput');
    const stationImageInput = document.getElementById('stationImageInput');
    const imagePreview = document.getElementById('imagePreview');

    const toastEl = document.getElementById('liveToast');
    const toastMessage = document.getElementById('toastMessage');
    const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
    const filterLabel = document.getElementById('filterLabel');

    // ---- Caching ----
    function getCachedData(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (Date.now() - data.timestamp > CACHE_TTL || !Array.isArray(data.value) || data.value.length === 0) {
                localStorage.removeItem(key);
                return null;
            }
            return data.value;
        } catch (e) { return null; }
    }

    function setCachedData(key, value) {
        if (!Array.isArray(value) || value.length === 0) return;
        try {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), value }));
        } catch (e) { /* ignore */ }
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function showToast(msg) {
        toastMessage.textContent = msg;
        toast.show();
    }

    // Reads an error message from a failed response, even if the body isn't JSON.
    async function readError(res) {
        try {
            const data = await res.json();
            if (data && data.error) return data.error;
        } catch (e) { /* not JSON */ }
        return `HTTP ${res.status}`;
    }

    // ---- Paste functionality ----
    async function pasteFromClipboard() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            showToast('Clipboard access is not available. Please use Ctrl+V (Cmd+V on Mac).');
            return;
        }
        try {
            const text = (await navigator.clipboard.readText()).trim();
            if (!text) {
                showToast('Clipboard is empty.');
                return;
            }
            stationUrlInput.value = text;
            stationUrlInput.dispatchEvent(new Event('input'));
            showToast('URL pasted successfully!');
        } catch (err) {
            showToast('Clipboard access was blocked. Please use Ctrl+V (Cmd+V on Mac).');
        }
    }

    // ---- URL validation ----
    function setUrlStatus(state, message) {
        urlStatus.textContent = message || '';
        urlStatus.className = state ? `url-status ${state}` : 'url-status';
        stationUrlInput.classList.remove('url-valid', 'url-invalid', 'url-checking');
        if (state) stationUrlInput.classList.add(`url-${state}`);
    }

    function resetValidationState() {
        clearTimeout(urlCheckTimeout);
        validationSeq++; // results of checks still running are now ignored
        validatedUrl = null;
        urlValid = false;
        setUrlStatus(null, '');
    }

    function validateStreamUrl(url) {
        resetValidationState();
        if (!url) {
            setUrlStatus('invalid', 'Please enter a URL.');
            return Promise.resolve(false);
        }

        const seq = validationSeq;
        setUrlStatus('checking', 'Checking stream...');

        return new Promise((resolve) => {
            const testAudio = new Audio();
            let finished = false;

            function finish(ok, message) {
                if (finished) return;
                finished = true;
                clearTimeout(timeoutId);
                testAudio.removeEventListener('loadedmetadata', onSuccess);
                testAudio.removeEventListener('error', onError);
                testAudio.removeAttribute('src');
                testAudio.load();

                // A newer check (or a URL change) has started since this one: drop the result.
                if (seq !== validationSeq) { resolve(false); return; }

                urlValid = ok;
                validatedUrl = ok ? url : null;
                setUrlStatus(ok ? 'valid' : 'invalid', message);
                resolve(ok);
            }

            function onSuccess() { finish(true, '✅ Stream is valid and can play!'); }
            function onError() { finish(false, '❌ Cannot play this stream. Please check the URL.'); }

            const timeoutId = setTimeout(
                () => finish(false, '❌ Connection timeout. Stream is slow or unavailable.'),
                URL_CHECK_TIMEOUT
            );

            testAudio.addEventListener('loadedmetadata', onSuccess);
            testAudio.addEventListener('error', onError);
            testAudio.src = url;
            testAudio.load();
        });
    }

    // ---- Genres & languages ----
    async function loadList(cacheKey, path, field, fallback) {
        const cached = getCachedData(cacheKey);
        if (cached) return cached;
        try {
            const res = await fetch(`${API_BASE}${path}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const list = Array.isArray(data[field]) ? data[field] : [];
            if (list.length === 0) throw new Error(`Empty ${field} list`);
            setCachedData(cacheKey, list);
            return list;
        } catch (e) {
            console.warn(`${field} fallback:`, e);
            return fallback;
        }
    }

    function fillSelect(select, placeholder, items) {
        const val = select.value;
        select.innerHTML = '';
        select.appendChild(new Option(placeholder, ''));
        items.forEach(item => select.appendChild(new Option(item.name, item.id)));
        if (val) select.value = val;
    }

    function getGenreId(name) {
        return genreMap[name.toLowerCase()] || name;
    }

    // ---- Station API calls ----
    function getTotal(data) {
        return Number((data.pagination && data.pagination.total) || data.total) || 0;
    }

    async function fetchHomeStations() {
        const seq = ++homeRequestSeq;
        const params = { limit: LIMIT, offset: homePage * LIMIT };
        if (homeFilter !== 'famous') params.genreId = getGenreId(homeFilter);

        try {
            const res = await fetch(`${API_BASE}/stations?${new URLSearchParams(params)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (seq !== homeRequestSeq) return; // a newer request replaced this one
            homeStations = data.stations || [];
            homeTotal = getTotal(data);
        } catch (e) {
            if (seq !== homeRequestSeq) return;
            console.error('Home fetch error:', e);
            showToast('Failed to load stations.');
            homeStations = [];
            homeTotal = 0;
        }
        renderHomePage();
    }

    async function fetchSearchStations() {
        const seq = ++searchRequestSeq;
        const params = { limit: LIMIT, offset: searchPageNum * LIMIT };
        const search = searchInput.value.trim();
        if (search) params.search = search;
        if (genreFilter.value) params.genreId = genreFilter.value;
        if (languageFilter.value) params.languageId = languageFilter.value;

        try {
            const res = await fetch(`${API_BASE}/stations?${new URLSearchParams(params)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (seq !== searchRequestSeq) return;
            searchResults = data.stations || [];
            searchTotal = getTotal(data);
        } catch (e) {
            if (seq !== searchRequestSeq) return;
            console.error('Search error:', e);
            showToast('Search failed.');
            searchResults = [];
            searchTotal = 0;
        }
        renderSearchPage();
    }

    async function createStation(name, url, genreId, languageId, description, imageFile) {
        const payload = { name, url, genreId, languageId };
        if (description) payload.description = description;

        let data;
        try {
            const res = await fetch(`${API_BASE}/stations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': SESSION_ID
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(await readError(res));
            data = await res.json();
        } catch (e) {
            showToast(`Error: ${e.message}`);
            return false;
        }

        let iconError = null;
        if (imageFile && data && data.id) {
            try {
                const formData = new FormData();
                formData.append('file', imageFile, imageFile.name);
                const iconRes = await fetch(`${API_BASE}/stations/${encodeURIComponent(data.id)}/icon`, {
                    method: 'POST',
                    headers: { 'X-Session-Id': SESSION_ID },
                    body: formData
                });
                if (!iconRes.ok) throw new Error(await readError(iconRes));
            } catch (e) {
                console.warn('Icon upload failed:', e);
                iconError = e.message;
            }
        }

        showToast(iconError
            ? `Station "${name}" added, but the image upload failed: ${iconError}`
            : `Station "${name}" added!`);

        if (isMainPageActive()) fetchHomeStations();
        else fetchSearchStations();
        return true;
    }

    // ---- Rendering ----
    function isMainPageActive() {
        return mainPage.classList.contains('active');
    }

    function renderActivePage() {
        if (isMainPageActive()) renderHomePage();
        else renderSearchPage();
    }

    function setPagerItem(item, link, disabled) {
        item.classList.toggle('disabled', disabled);
        link.setAttribute('aria-disabled', String(disabled));
        link.tabIndex = disabled ? -1 : 0;
    }

    // The API already returns one page, so the list is rendered as-is.
    function renderStations(container, stations, page, total, info, prevItem, prevLink, nextItem, nextLink) {
        container.innerHTML = '';
        if (stations.length === 0) {
            container.innerHTML = '<div class="text-center text-secondary py-5" style="grid-column:1/-1;">No stations found</div>';
        } else {
            stations.forEach(st => renderCard(container, st));
        }

        const totalPages = Math.ceil(total / LIMIT) || 1;
        info.textContent = `${page + 1} / ${totalPages}`;
        setPagerItem(prevItem, prevLink, page === 0);
        setPagerItem(nextItem, nextLink, page >= totalPages - 1);
    }

    function renderHomePage() {
        renderStations(grid, homeStations, homePage, homeTotal,
            pageInfo, prevPageItem, prevPageBtn, nextPageItem, nextPageBtn);
    }

    function renderSearchPage() {
        renderStations(searchGrid, searchResults, searchPageNum, searchTotal,
            searchPageInfo, searchPrevPage, searchPrevBtn, searchNextPage, searchNextBtn);
    }

    function renderCard(container, st) {
        const isCurrent = currentStationId === st.id;
        const card = document.createElement('div');
        card.className = `station-card${isCurrent ? ' active' : ''}`;
        card.dataset.id = st.id;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', `Play ${st.name || 'station'}`);
        const artworkHtml = st.icon
            ? `<img src="${escapeHtml(st.icon)}" alt="${escapeHtml(st.name)}">`
            : '<i class="bi bi-radio"></i>';
        const genreName = (genres.find(g => g.id === st.genre) || {}).name || st.genre || 'mixed';
        const langName = (languages.find(l => l.id === st.language) || {}).name || st.language || 'world';
        card.innerHTML = `
                <div class="artwork">${artworkHtml}</div>
                <div class="station-name">${escapeHtml(st.name)}</div>
                <span class="genre-tag">${escapeHtml(genreName)}</span>
                <div class="country-flag"><i class="bi bi-geo-alt"></i> ${escapeHtml(langName)}</div>
                <div class="play-indicator">${isCurrent && isPlaying ? '🔊 playing' : ''}</div>
            `;
        card.addEventListener('click', () => playStation(st.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                playStation(st.id);
            }
        });
        container.appendChild(card);
    }

    // ---- Player ----
    function getStationById(id) {
        return homeStations.find(s => s.id === id) || searchResults.find(s => s.id === id);
    }

    function setPlayingUI(playing) {
        isPlaying = playing;
        playPauseBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
        playPauseBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        renderActivePage();
    }

    // Stops and detaches the current audio element. Clearing audioElement first
    // makes its pause/error events ignored by the handlers below.
    function releaseAudio() {
        if (!audioElement) return;
        const audio = audioElement;
        audioElement = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    }

    function handlePlayError(audio, err) {
        if (audio !== audioElement || (err && err.name === 'AbortError')) return;
        setPlayingUI(false);
        showToast(err && err.name === 'NotAllowedError'
            ? 'Playback was blocked by the browser. Press play to start.'
            : 'Could not start the stream.');
    }

    function playStation(stationId) {
        const station = getStationById(stationId);
        if (!station) return;

        if (currentStationId === stationId && audioElement && isPlaying) {
            pauseAudio();
            return;
        }

        releaseAudio();

        const audio = new Audio();
        audio.volume = parseFloat(volumeSlider.value);
        audio.addEventListener('error', () => {
            if (audio !== audioElement) return;
            showToast('Could not load stream.');
            resetPlayerUI();
        });
        audio.addEventListener('playing', () => {
            if (audio === audioElement && !isPlaying) setPlayingUI(true);
        });
        audio.addEventListener('pause', () => {
            if (audio === audioElement && isPlaying) setPlayingUI(false);
        });
        audio.src = station.url;

        audioElement = audio;
        currentStationId = station.id;
        currentStationName.textContent = station.name;
        setPlayingUI(true);
        audio.play().catch(err => handlePlayError(audio, err));

        fetch(`${API_BASE}/stations/${encodeURIComponent(stationId)}/play`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': SESSION_ID
            },
            body: JSON.stringify({ session_id: SESSION_ID })
        }).catch(() => { });
    }

    function pauseAudio() {
        if (!audioElement) return;
        audioElement.pause();
        setPlayingUI(false);
    }

    function resetPlayerUI() {
        releaseAudio();
        currentStationId = null;
        currentStationName.textContent = 'Select a station';
        setPlayingUI(false);
    }

    function stopAudio() {
        if (audioElement || currentStationId) resetPlayerUI();
    }

    function togglePlayPause() {
        if (!audioElement || !currentStationId) {
            const first = isMainPageActive() ? homeStations[0] : searchResults[0];
            if (first) playStation(first.id);
            return;
        }
        if (isPlaying) {
            pauseAudio();
        } else {
            const audio = audioElement;
            setPlayingUI(true);
            audio.play().catch(err => handlePlayError(audio, err));
        }
    }

    // ---- Navigation ----
    function showMainPage() {
        mainPage.classList.add('active');
        searchPage.classList.remove('active');
        mainPageLink.classList.add('active');
        searchPageLink.classList.remove('active');
        fetchHomeStations();
    }

    function showSearchPage() {
        mainPage.classList.remove('active');
        searchPage.classList.add('active');
        mainPageLink.classList.remove('active');
        searchPageLink.classList.add('active');
        fetchSearchStations();
    }

    // ---- Add station form ----
    function resetAddStationForm() {
        stationNameInput.value = '';
        stationUrlInput.value = '';
        stationGenreSelect.value = '';
        stationLanguageSelect.value = '';
        stationDescriptionInput.value = '';
        stationImageInput.value = '';
        imagePreview.innerHTML = IMAGE_PLACEHOLDER;
        resetValidationState();
    }

    function setSubmitting(value) {
        submitting = value;
        submitStationBtn.disabled = value;
        checkUrlBtn.disabled = value;
        submitStationBtn.innerHTML = value
            ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Adding...'
            : '<i class="bi bi-check-lg"></i> Add station';
    }

    async function submitStation() {
        if (submitting) return;

        const name = stationNameInput.value.trim();
        const url = stationUrlInput.value.trim();
        const genreId = stationGenreSelect.value;
        const languageId = stationLanguageSelect.value;
        const description = stationDescriptionInput.value.trim();
        const imageFile = stationImageInput.files[0] || null;

        if (!name) { showToast('Station name is required.'); return; }
        if (!url) { showToast('Stream URL is required.'); return; }
        if (!genreId) { showToast('Please select a genre.'); return; }
        if (!languageId) { showToast('Please select a language.'); return; }

        setSubmitting(true);
        try {
            if (!urlValid || validatedUrl !== url) {
                const isValid = await validateStreamUrl(url);
                if (!isValid || stationUrlInput.value.trim() !== url) {
                    showToast('Please provide a valid stream URL.');
                    return;
                }
            }

            const ok = await createStation(name, url, genreId, languageId, description, imageFile);
            if (ok) {
                bootstrap.Modal.getOrCreateInstance(addStationModal).hide();
                resetAddStationForm();
            }
        } finally {
            setSubmitting(false);
        }
    }

    // ---- Event binding ----
    document.querySelectorAll('#mainPage .filter-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#mainPage .filter-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            this.classList.add('active');
            this.setAttribute('aria-pressed', 'true');
            homeFilter = this.dataset.filter;
            homePage = 0;
            filterLabel.textContent = homeFilter === 'famous'
                ? '⭐ Famous Radio'
                : homeFilter.charAt(0).toUpperCase() + homeFilter.slice(1);
            fetchHomeStations();
        });
    });

    mainPageLink.addEventListener('click', (e) => { e.preventDefault(); showMainPage(); });
    searchPageLink.addEventListener('click', (e) => { e.preventDefault(); showSearchPage(); });

    prevPageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (homePage > 0) { homePage--; fetchHomeStations(); }
    });
    nextPageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (homePage < Math.ceil(homeTotal / LIMIT) - 1) { homePage++; fetchHomeStations(); }
    });

    searchPrevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (searchPageNum > 0) { searchPageNum--; fetchSearchStations(); }
    });
    searchNextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (searchPageNum < Math.ceil(searchTotal / LIMIT) - 1) { searchPageNum++; fetchSearchStations(); }
    });

    function newSearch() {
        searchPageNum = 0;
        fetchSearchStations();
    }

    searchBtn.addEventListener('click', newSearch);
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        genreFilter.value = '';
        languageFilter.value = '';
        newSearch();
    });
    searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') newSearch(); });
    genreFilter.addEventListener('change', newSearch);
    languageFilter.addEventListener('change', newSearch);

    playPauseBtn.addEventListener('click', togglePlayPause);
    stopBtn.addEventListener('click', stopAudio);
    volumeSlider.addEventListener('input', function () {
        if (audioElement) audioElement.volume = parseFloat(this.value);
    });

    pasteUrlBtn.addEventListener('click', pasteFromClipboard);
    checkUrlBtn.addEventListener('click', () => validateStreamUrl(stationUrlInput.value.trim()));

    // Re-check the URL shortly after the user stops typing.
    stationUrlInput.addEventListener('input', function () {
        const currentUrl = this.value.trim();
        if (urlValid && currentUrl === validatedUrl) return;
        resetValidationState();
        if (!currentUrl) return;
        urlCheckTimeout = setTimeout(() => validateStreamUrl(currentUrl), 800);
    });

    submitStationBtn.addEventListener('click', submitStation);

    stationImageInput.addEventListener('change', function () {
        const file = this.files[0];
        imagePreview.innerHTML = IMAGE_PLACEHOLDER;
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = document.createElement('img');
            img.src = ev.target.result;
            img.alt = 'preview';
            imagePreview.replaceChildren(img);
        };
        reader.readAsDataURL(file);
    });

    addStationModal.addEventListener('show.bs.modal', resetAddStationForm);

    // Space toggles playback, unless the user is typing, on a button, or in a dialog.
    document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space') return;
        const t = e.target;
        if (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(t.tagName)) return;
        if (t.closest && t.closest('[role="button"], .modal')) return;
        if (document.body.classList.contains('modal-open')) return;
        e.preventDefault();
        togglePlayPause();
    });

    // ---- Init ----
    async function init() {
        [genres, languages] = await Promise.all([
            loadList(CACHE_KEY_GENRES, '/genres', 'genres', FALLBACK_GENRES),
            loadList(CACHE_KEY_LANGUAGES, '/languages', 'languages', FALLBACK_LANGUAGES),
        ]);
        genreMap = {};
        genres.forEach(g => { genreMap[String(g.name).toLowerCase()] = g.id; });
        fillSelect(genreFilter, 'Genre', genres);
        fillSelect(stationGenreSelect, 'Select genre...', genres);
        fillSelect(languageFilter, 'Language', languages);
        fillSelect(stationLanguageSelect, 'Select language...', languages);
        showMainPage();
    }
    init();

})();

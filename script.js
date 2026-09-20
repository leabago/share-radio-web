(function () {
    'use strict';

    const API_BASE = 'http://localhost:8080';
    const CACHE_KEY_GENRES = 'radiowave_genres';
    const CACHE_KEY_LANGUAGES = 'radiowave_languages';
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

    // ---- Session management ----
    function getOrCreateSessionId() {
        let sessionId = localStorage.getItem('radioSession');
        if (!sessionId) {
            sessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
            localStorage.setItem('radioSession', sessionId);
            console.log('🆕 New session created:', sessionId);
        } else {
            console.log('♻️ Existing session found:', sessionId);
        }
        return sessionId;
    }

    // Create session immediately when script loads
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

    // Search page state
    let searchPageNum = 0;
    let searchResults = [];
    let searchTotal = 0;

    // URL validation state - track the validated URL
    let validatedUrl = null;
    let urlValid = false;
    let urlChecking = false;

    const LIMIT = 12;
    let genres = [];
    let languages = [];
    let genreMap = {};
    let languageMap = {};

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
            if (Date.now() - data.timestamp > CACHE_TTL) {
                localStorage.removeItem(key);
                return null;
            }
            return data.value;
        } catch (e) { return null; }
    }

    function setCachedData(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), value }));
        } catch (e) { /* ignore */ }
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] || m));
    }

    function showToast(msg) {
        toastMessage.textContent = msg;
        toast.show();
    }

    // ---- Paste functionality ----
    async function pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                stationUrlInput.value = text;
                // Reset validation state when pasting
                resetValidationState();
                // Trigger input event to auto-check
                stationUrlInput.dispatchEvent(new Event('input'));
                showToast('URL pasted successfully!');
            }
        } catch (err) {
            try {
                const pasteTarget = document.createElement('textarea');
                document.body.appendChild(pasteTarget);
                pasteTarget.focus();
                document.execCommand('paste');
                const pastedText = pasteTarget.value;
                document.body.removeChild(pasteTarget);
                if (pastedText) {
                    stationUrlInput.value = pastedText;
                    resetValidationState();
                    stationUrlInput.dispatchEvent(new Event('input'));
                    showToast('URL pasted successfully!');
                }
            } catch (fallbackErr) {
                showToast('Unable to paste. Please use Ctrl+V (Cmd+V on Mac).');
            }
        }
    }

    // ---- Reset validation state ----
    function resetValidationState() {
        validatedUrl = null;
        urlValid = false;
        urlChecking = false;
        urlStatus.textContent = '';
        urlStatus.className = 'url-status';
        stationUrlInput.className = 'form-control';
    }

    // ---- SIMPLIFIED URL VALIDATION ----
    async function validateStreamUrl(url) {
        if (!url || !url.trim()) {
            urlStatus.textContent = 'Please enter a URL.';
            urlStatus.className = 'url-status invalid';
            urlValid = false;
            validatedUrl = null;
            stationUrlInput.classList.remove('url-valid', 'url-invalid', 'url-checking');
            return false;
        }

        urlChecking = true;
        urlValid = false;
        validatedUrl = null;
        urlStatus.textContent = 'Checking stream...';
        urlStatus.className = 'url-status checking';
        stationUrlInput.className = 'form-control url-checking';

        return new Promise((resolve) => {
            const testAudio = new Audio();
            testAudio.crossOrigin = 'anonymous';
            testAudio.src = url;

            const timeoutId = setTimeout(() => {
                testAudio.removeEventListener('loadedmetadata', onSuccess);
                testAudio.removeEventListener('error', onError);
                testAudio.src = '';
                urlChecking = false;
                urlValid = false;
                validatedUrl = null;
                urlStatus.textContent = '❌ Connection timeout. Stream is slow or unavailable.';
                urlStatus.className = 'url-status invalid';
                stationUrlInput.className = 'form-control url-invalid';
                resolve(false);
            }, 15000);

            function onSuccess() {
                clearTimeout(timeoutId);
                testAudio.removeEventListener('loadedmetadata', onSuccess);
                testAudio.removeEventListener('error', onError);
                testAudio.src = '';
                urlChecking = false;
                urlValid = true;
                validatedUrl = url;
                urlStatus.textContent = '✅ Stream is valid and can play!';
                urlStatus.className = 'url-status valid';
                stationUrlInput.className = 'form-control url-valid';
                resolve(true);
            }

            function onError() {
                clearTimeout(timeoutId);
                testAudio.removeEventListener('loadedmetadata', onSuccess);
                testAudio.removeEventListener('error', onError);
                testAudio.src = '';
                urlChecking = false;
                urlValid = false;
                validatedUrl = null;
                urlStatus.textContent = '❌ Cannot play this stream. Please check the URL.';
                urlStatus.className = 'url-status invalid';
                stationUrlInput.className = 'form-control url-invalid';
                resolve(false);
            }

            testAudio.addEventListener('loadedmetadata', onSuccess);
            testAudio.addEventListener('error', onError);
            testAudio.load();
        });
    }

    // ---- API ----
    async function fetchGenres() {
        const cached = getCachedData(CACHE_KEY_GENRES);
        if (cached) {
            genres = cached;
            buildGenreMap();
            populateGenreFilter();
            populateGenreSelect();
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/genres`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            genres = data.genres || [];
            setCachedData(CACHE_KEY_GENRES, genres);
            buildGenreMap();
            populateGenreFilter();
            populateGenreSelect();
        } catch (e) {
            console.warn('Genres fallback:', e);
            genres = [
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
            buildGenreMap();
            populateGenreFilter();
            populateGenreSelect();
        }
    }

    async function fetchLanguages() {
        const cached = getCachedData(CACHE_KEY_LANGUAGES);
        if (cached) {
            languages = cached;
            buildLanguageMap();
            populateLanguageFilter();
            populateLanguageSelect();
            return;
        }
        try {
            const res = await fetch(`${API_BASE}/languages`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            languages = data.languages || [];
            setCachedData(CACHE_KEY_LANGUAGES, languages);
            buildLanguageMap();
            populateLanguageFilter();
            populateLanguageSelect();
        } catch (e) {
            console.warn('Languages fallback:', e);
            languages = [
                { id: 'en-id', name: 'English' },
                { id: 'ru-id', name: 'Russian' },
                { id: 'fr-id', name: 'French' },
                { id: 'de-id', name: 'German' },
                { id: 'es-id', name: 'Spanish' },
                { id: 'ja-id', name: 'Japanese' },
            ];
            buildLanguageMap();
            populateLanguageFilter();
            populateLanguageSelect();
        }
    }

    function buildGenreMap() {
        genreMap = {};
        genres.forEach(g => { genreMap[g.name.toLowerCase()] = g.id; });
    }

    function buildLanguageMap() {
        languageMap = {};
        languages.forEach(l => { languageMap[l.name.toLowerCase()] = l.id; });
    }

    function populateGenreFilter() {
        const val = genreFilter.value;
        genreFilter.innerHTML = '<option value="">Genre</option>';
        genres.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            genreFilter.appendChild(opt);
        });
        if (val) genreFilter.value = val;
    }

    function populateLanguageFilter() {
        const val = languageFilter.value;
        languageFilter.innerHTML = '<option value="">Language</option>';
        languages.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name;
            languageFilter.appendChild(opt);
        });
        if (val) languageFilter.value = val;
    }

    function populateGenreSelect() {
        const val = stationGenreSelect.value;
        stationGenreSelect.innerHTML = '<option value="">Select genre...</option>';
        genres.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            stationGenreSelect.appendChild(opt);
        });
        if (val) stationGenreSelect.value = val;
    }

    function populateLanguageSelect() {
        const val = stationLanguageSelect.value;
        stationLanguageSelect.innerHTML = '<option value="">Select language...</option>';
        languages.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name;
            stationLanguageSelect.appendChild(opt);
        });
        if (val) stationLanguageSelect.value = val;
    }

    function getGenreId(name) {
        return genreMap[name.toLowerCase()] || name;
    }

    function getLanguageId(name) {
        return languageMap[name.toLowerCase()] || name;
    }

    // ---- API calls ----
    async function fetchHomeStations() {
        const params = { limit: LIMIT, offset: homePage * LIMIT };

        if (homeFilter === 'famous') {
            // Famous radio - just fetch all stations
        } else {
            const genreId = getGenreId(homeFilter);
            if (genreId) params.genreId = genreId;
        }

        const query = new URLSearchParams(params);
        try {
            const res = await fetch(`${API_BASE}/stations?${query}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            homeStations = data.stations || [];
            homeTotal = data.pagination?.total || data.total || 0;
            renderHomePage();
        } catch (e) {
            console.error('Home fetch error:', e);
            showToast('Failed to load stations.');
            homeStations = [];
            homeTotal = 0;
            renderHomePage();
        }
    }

    async function fetchSearchStations() {
        const params = { limit: LIMIT, offset: searchPageNum * LIMIT };
        const search = searchInput.value.trim();
        const genreId = genreFilter.value;
        const languageId = languageFilter.value;
        if (search) params.search = search;
        if (genreId) params.genreId = genreId;
        if (languageId) params.languageId = languageId;

        const query = new URLSearchParams(params);
        try {
            const res = await fetch(`${API_BASE}/stations?${query}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            searchResults = data.stations || [];
            searchTotal = data.pagination?.total || data.total || 0;
            renderSearchPage();
        } catch (e) {
            console.error('Search error:', e);
            searchResults = [];
            searchTotal = 0;
            renderSearchPage();
        }
    }

    async function createStation(name, url, genreId, languageId, description, imageData) {
        const payload = { name, url, genreId, languageId };
        if (description) payload.description = description;

        try {
            const res = await fetch(`${API_BASE}/stations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Id': SESSION_ID
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            if (imageData && data.id) {
                try {
                    const blob = dataURLtoBlob(imageData);
                    const formData = new FormData();
                    formData.append('file', blob, 'icon.png');
                    await fetch(`${API_BASE}/stations/${data.id}/icon`, {
                        method: 'POST',
                        headers: {
                            'X-Session-Id': SESSION_ID
                        },
                        body: formData
                    });
                } catch (iconErr) { console.warn('Icon upload failed:', iconErr); }
            }
            showToast(`Station "${name}" added!`);
            // Refresh current page
            if (mainPage.classList.contains('active')) {
                fetchHomeStations();
            } else {
                fetchSearchStations();
            }
            return true;
        } catch (e) {
            showToast(`Error: ${e.message}`);
            return false;
        }
    }

    function dataURLtoBlob(dataURL) {
        const arr = dataURL.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new Blob([u8arr], { type: mime });
    }

    // ---- Rendering ----
    function renderHomePage() {
        const start = homePage * LIMIT;
        const end = Math.min(start + LIMIT, homeStations.length);
        const items = homeStations.slice(start, end);

        grid.innerHTML = '';
        if (items.length === 0) {
            grid.innerHTML = `<div class="text-center text-secondary py-5" style="grid-column:1/-1;">No stations found</div>`;
        } else {
            items.forEach(st => renderCard(grid, st));
        }

        const totalPages = Math.ceil(homeTotal / LIMIT) || 1;
        pageInfo.textContent = `${homePage + 1} / ${totalPages}`;
        prevPageItem.classList.toggle('disabled', homePage === 0);
        nextPageItem.classList.toggle('disabled', homePage >= totalPages - 1);
    }

    function renderSearchPage() {
        const start = searchPageNum * LIMIT;
        const end = Math.min(start + LIMIT, searchResults.length);
        const items = searchResults.slice(start, end);

        searchGrid.innerHTML = '';
        if (items.length === 0) {
            searchGrid.innerHTML = `<div class="text-center text-secondary py-5" style="grid-column:1/-1;">No stations found</div>`;
        } else {
            items.forEach(st => renderCard(searchGrid, st));
        }

        const totalPages = Math.ceil(searchTotal / LIMIT) || 1;
        searchPageInfo.textContent = `${searchPageNum + 1} / ${totalPages}`;
        searchPrevPage.classList.toggle('disabled', searchPageNum === 0);
        searchNextPage.classList.toggle('disabled', searchPageNum >= totalPages - 1);
    }

    function renderCard(container, st) {
        const card = document.createElement('div');
        card.className = `station-card ${currentStationId === st.id ? 'active' : ''}`;
        card.dataset.id = st.id;
        let artworkHtml = st.icon ? `<img src="${st.icon}" alt="${escapeHtml(st.name)}">` : `<i class="bi bi-radio"></i>`;
        const genreName = genres.find(g => g.id === st.genre)?.name || st.genre || 'mixed';
        const langName = languages.find(l => l.id === st.language)?.name || st.language || 'world';
        card.innerHTML = `
                <div class="artwork">${artworkHtml}</div>
                <div class="station-name">${escapeHtml(st.name)}</div>
                <span class="genre-tag">${escapeHtml(genreName)}</span>
                <div class="country-flag"><i class="bi bi-geo-alt"></i> ${escapeHtml(langName)}</div>
                <div class="play-indicator">${currentStationId === st.id && isPlaying ? '🔊 playing' : ''}</div>
            `;
        card.addEventListener('click', () => playStation(st.id));
        container.appendChild(card);
    }

    // ---- Player ----
    function getStationById(id) {
        let st = homeStations.find(s => s.id === id);
        if (!st) st = searchResults.find(s => s.id === id);
        return st;
    }

    function playStation(stationId) {
        const station = getStationById(stationId);
        if (!station) return;

        if (currentStationId === stationId && audioElement && isPlaying) {
            pauseAudio();
            return;
        }

        if (audioElement) {
            audioElement.pause();
            audioElement.src = '';
            audioElement = null;
            isPlaying = false;
        }

        const audio = new Audio(station.url);
        audio.volume = parseFloat(volumeSlider.value);
        audio.crossOrigin = 'anonymous';
        audio.addEventListener('error', () => {
            showToast('Could not load stream.');
            resetPlayerUI();
        });

        audioElement = audio;
        currentStationId = station.id;
        currentStationName.textContent = station.name;
        playPauseBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
        isPlaying = true;
        audio.play().catch(() => { });

        if (mainPage.classList.contains('active')) renderHomePage();
        else renderSearchPage();

        fetch(`${API_BASE}/stations/${stationId}/play`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Id': SESSION_ID
            },
            body: JSON.stringify({ session_id: SESSION_ID })
        }).catch(() => { });
    }

    function pauseAudio() {
        if (audioElement) {
            audioElement.pause();
            isPlaying = false;
            playPauseBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
            if (mainPage.classList.contains('active')) renderHomePage();
            else renderSearchPage();
        }
    }

    function stopAudio() {
        if (audioElement) {
            audioElement.pause();
            audioElement.src = '';
            audioElement = null;
            isPlaying = false;
            currentStationId = null;
            currentStationName.textContent = 'Select a station';
            playPauseBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
            if (mainPage.classList.contains('active')) renderHomePage();
            else renderSearchPage();
        }
    }

    function resetPlayerUI() {
        if (audioElement) {
            audioElement.pause();
            audioElement.src = '';
            audioElement = null;
        }
        isPlaying = false;
        currentStationId = null;
        currentStationName.textContent = 'Select a station';
        playPauseBtn.innerHTML = '<i class="bi bi-play-fill"></i>';
        if (mainPage.classList.contains('active')) renderHomePage();
        else renderSearchPage();
    }

    function togglePlayPause() {
        if (!audioElement || !currentStationId) {
            const first = mainPage.classList.contains('active') ? homeStations[0] : searchResults[0];
            if (first) playStation(first.id);
            return;
        }
        if (isPlaying) pauseAudio();
        else {
            if (audioElement) {
                audioElement.play().catch(() => { });
                isPlaying = true;
                playPauseBtn.innerHTML = '<i class="bi bi-pause-fill"></i>';
                if (mainPage.classList.contains('active')) renderHomePage();
                else renderSearchPage();
            }
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

    // ---- Event binding ----
    // Home filter buttons
    document.querySelectorAll('#mainPage .filter-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#mainPage .filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            homeFilter = this.dataset.filter;
            homePage = 0;
            const label = homeFilter === 'famous' ? '⭐ Famous Radio' : homeFilter.charAt(0).toUpperCase() + homeFilter.slice(1);
            filterLabel.textContent = label;
            fetchHomeStations();
        });
    });

    // Page navigation
    mainPageLink.addEventListener('click', (e) => { e.preventDefault(); showMainPage(); });
    searchPageLink.addEventListener('click', (e) => { e.preventDefault(); showSearchPage(); });

    // Home pagination
    prevPageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (homePage > 0) { homePage--; fetchHomeStations(); }
    });
    nextPageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const totalPages = Math.ceil(homeTotal / LIMIT);
        if (homePage < totalPages - 1) { homePage++; fetchHomeStations(); }
    });

    // Search pagination
    searchPrevBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (searchPageNum > 0) { searchPageNum--; fetchSearchStations(); }
    });
    searchNextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const totalPages = Math.ceil(searchTotal / LIMIT);
        if (searchPageNum < totalPages - 1) { searchPageNum++; fetchSearchStations(); }
    });

    // Search controls
    searchBtn.addEventListener('click', () => { searchPageNum = 0; fetchSearchStations(); });
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        genreFilter.value = '';
        languageFilter.value = '';
        searchPageNum = 0;
        fetchSearchStations();
    });
    searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') { searchPageNum = 0; fetchSearchStations(); } });
    genreFilter.addEventListener('change', () => { searchPageNum = 0; fetchSearchStations(); });
    languageFilter.addEventListener('change', () => { searchPageNum = 0; fetchSearchStations(); });

    // Player
    playPauseBtn.addEventListener('click', togglePlayPause);
    stopBtn.addEventListener('click', stopAudio);
    volumeSlider.addEventListener('input', function () {
        if (audioElement) audioElement.volume = parseFloat(this.value);
    });

    // Paste button
    pasteUrlBtn.addEventListener('click', pasteFromClipboard);

    // URL Check button
    checkUrlBtn.addEventListener('click', async function () {
        const url = stationUrlInput.value.trim();
        if (!url) {
            urlStatus.textContent = 'Please enter a URL first.';
            urlStatus.className = 'url-status invalid';
            urlValid = false;
            validatedUrl = null;
            stationUrlInput.className = 'form-control url-invalid';
            return;
        }
        await validateStreamUrl(url);
    });

    // Auto-check on URL input change - reset validation when URL changes
    let urlCheckTimeout = null;
    stationUrlInput.addEventListener('input', function () {
        clearTimeout(urlCheckTimeout);
        const currentUrl = this.value.trim();
        const previousUrl = validatedUrl;

        // If the URL changed from what was validated, reset validation state
        if (previousUrl !== null && currentUrl !== previousUrl) {
            resetValidationState();
        }

        // If URL is empty, just reset
        if (!currentUrl) {
            resetValidationState();
            return;
        }

        // Auto-check with debounce
        urlCheckTimeout = setTimeout(async () => {
            await validateStreamUrl(currentUrl);
        }, 800);
    });

    // Add station
    submitStationBtn.addEventListener('click', async function () {
        const name = stationNameInput.value.trim();
        const url = stationUrlInput.value.trim();
        const genreId = stationGenreSelect.value;
        const languageId = stationLanguageSelect.value;
        const description = stationDescriptionInput.value.trim();
        let imageData = null;
        const previewImg = imagePreview.querySelector('img');
        if (previewImg) imageData = previewImg.src;

        if (!name) { showToast('Station name is required.'); return; }
        if (!url) { showToast('Stream URL is required.'); return; }
        if (!genreId) { showToast('Please select a genre.'); return; }
        if (!languageId) { showToast('Please select a language.'); return; }

        // Check if the current URL matches the validated URL
        if (!urlValid || validatedUrl !== url) {
            // Try to validate the URL first
            const isValid = await validateStreamUrl(url);
            if (!isValid) {
                showToast('Please provide a valid stream URL.');
                return;
            }
        }

        // Double-check validation state
        if (!urlValid || validatedUrl !== url) {
            showToast('Please wait for URL validation to complete.');
            return;
        }

        createStation(name, url, genreId, languageId, description, imageData)
            .then(ok => {
                if (ok) {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('addStationModal'));
                    modal.hide();
                    stationNameInput.value = '';
                    stationUrlInput.value = '';
                    stationGenreSelect.value = '';
                    stationLanguageSelect.value = '';
                    stationDescriptionInput.value = '';
                    stationImageInput.value = '';
                    imagePreview.innerHTML = `<i class="bi bi-image placeholder-icon"></i>`;
                    resetValidationState();
                }
            });
    });

    stationImageInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) { imagePreview.innerHTML = `<i class="bi bi-image placeholder-icon"></i>`; return; }
        const reader = new FileReader();
        reader.onload = (ev) => { imagePreview.innerHTML = `<img src="${ev.target.result}" alt="preview">`; };
        reader.readAsDataURL(file);
    });

    // Reset modal fields when opened
    document.getElementById('addStationModal').addEventListener('show.bs.modal', function () {
        stationNameInput.value = '';
        stationUrlInput.value = '';
        stationGenreSelect.value = '';
        stationLanguageSelect.value = '';
        stationDescriptionInput.value = '';
        stationImageInput.value = '';
        imagePreview.innerHTML = `<i class="bi bi-image placeholder-icon"></i>`;
        resetValidationState();
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space') { e.preventDefault(); togglePlayPause(); }
    });

    // ---- Init ----
    async function init() {
        await fetchGenres();
        await fetchLanguages();
        showMainPage();
    }
    init();

})();

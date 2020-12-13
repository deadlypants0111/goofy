const VERSION = '1.3.0';
const keyValue = PropertiesService.getUserProperties().getProperties();
const CLIENT_ID = keyValue['CLIENT_ID'];
const CLIENT_SECRET = keyValue['CLIENT_SECRET'];
const LASTFM_API_KEY = keyValue['LASTFM_API_KEY'];
const ON_SPOTIFY_RECENT_TRACKS = 'true' === keyValue['ON_SPOTIFY_RECENT_TRACKS'];
const ON_LASTFM_RECENT_TRACKS = 'true' === keyValue['ON_LASTFM_RECENT_TRACKS'];
const LASTFM_RANGE_RECENT_TRACKS = parseInt(keyValue['LASTFM_RANGE_RECENT_TRACKS']);
const LASTFM_LOGIN = keyValue['LASTFM_LOGIN'];
const API_BASE_URL = 'https://api.spotify.com/v1';

function doGet() {
    return Auth.hasAccess() ? HtmlService.createHtmlOutput('Успешно') : Auth.displayAuthPage();
}

function displayAuthResult(request) {
    return Auth.displayAuthResult(request);
}

function updateRecentTracks() {
    RecentTracks.updateRecentTracks();
}

const User = (function () {
    const KEY_USER_ID = 'userId';

    function setId() {
        let response = Request.get('https://api.spotify.com/v1/me');
        PropertiesService.getUserProperties().setProperty(KEY_USER_ID, response.id);
    }

    function getId() {
        let userId = PropertiesService.getUserProperties().getProperty(KEY_USER_ID);
        if (userId == null) {
            setId();
            return getId();
        }
        return userId;
    }

    return {
        getId: getId,
    };
})();

const Auth = (function () {
    const SCOPE = [
        'playlist-read-private',
        'playlist-modify-private',
        'playlist-modify-public',
        'user-library-read',
        'user-top-read',
        'user-read-recently-played',
        'ugc-image-upload',
        'user-follow-read',
        'user-library-modify',
        'user-follow-modify',
    ];
    const _service = createService();

    if (VERSION != keyValue['VERSION']) {
        setVersion();
        sendVersion();
    }

    function reset() {
        _service.reset();
    }

    function createService() {
        return OAuth2.createService('spotify')
            .setAuthorizationBaseUrl('https://accounts.spotify.com/authorize')
            .setTokenUrl('https://accounts.spotify.com/api/token')
            .setClientId(CLIENT_ID)
            .setClientSecret(CLIENT_SECRET)
            .setCallbackFunction('displayAuthResult')
            .setPropertyStore(PropertiesService.getUserProperties())
            .setScope(SCOPE.join(' '))
            .setParam('response_type', 'code')
            .setParam('redirect_uri', getRedirectUri());
    }

    function displayAuthResult(request) {
        let isAuthorized = _service.handleCallback(request);
        if (isAuthorized) {
            return HtmlService.createHtmlOutput('Успешно! Можно закрыть вкладку.');
        } else {
            return HtmlService.createHtmlOutput('В доступе отказано. Можно закрыть вкладку.');
        }
    }

    function getRedirectUri() {
        let scriptId = encodeURIComponent(ScriptApp.getScriptId());
        let template = 'https://script.google.com/macros/d/%s/usercallback';
        return Utilities.formatString(template, scriptId);
    }

    function displayAuthPage() {
        let template = '<a href="%s" target="_blank">Authorize</a><p>%s</p>';
        let html = Utilities.formatString(template, _service.getAuthorizationUrl(), getRedirectUri());
        return HtmlService.createHtmlOutput(html);
    }

    function hasAccess() {
        return _service.hasAccess();
    }

    function getAccessToken() {
        return _service.getAccessToken();
    }

    function setVersion() {
        PropertiesService.getUserProperties().setProperty('VERSION', VERSION);
    }

    function sendVersion() {
        let url = 'https://docs.google.com/forms/u/0/d/e/1FAIpQLSfvxL6pMLbdUbefFSvEMfXkRPm_maKVbHX2H2jhDUpLHi8Lfw/formResponse';
        UrlFetchApp.fetch(url, {
            method: 'post',
            payload: {
                'entry.1598003363': VERSION,
                'entry.1594601658': ScriptApp.getScriptId(),
            },
        });
    }

    return {
        reset: reset,
        hasAccess: hasAccess,
        getAccessToken: getAccessToken,
        displayAuthPage: displayAuthPage,
        displayAuthResult: displayAuthResult,
    };
})();

const Cache = (function () {
    const FOLDER_NAME = 'Goofy Data';
    const rootFolder = getRootFolder();

    return {
        read: read,
        write: write,
        append: append,
        copy: copy,
        compressTracks: compressTracks,
    };

    function read(filename) {
        return getJSON(getFile(filename));
    }

    function append(filename, content, place = 'end', limit = 100000) {
        let currentContent = read(filename);
        if (place == 'begin') {
            // Новые данные в начало файла
            appendNewData(content, currentContent);
        } else if (place == 'end') {
            // Новые данные в конец файла
            appendNewData(currentContent, content);
        }

        function appendNewData(xData, yData) {
            Combiner.push(xData, yData);
            Selector.keepFirst(xData, limit);
            write(filename, xData);
        }
    }

    function write(filename, content) {
        let file = getFile(filename);
        if (!file) {
            file = createFile(filename);
        }
        file.setContent(JSON.stringify(content));
    }

    function copy(filename) {
        let file = getFile(filename);
        if (file) {
            let newFile = file.makeCopy();
            filename = 'Copy' + formatExtension(filename.split('.')[0]);
            newFile.setName(filename);
            return filename;
        }
    }

    function getFile(filename) {
        let files = getFileIterator(filename);
        if (files.hasNext()) {
            return files.next();
        }
    }

    function createFile(filename) {
        filename = formatExtension(filename);
        return rootFolder.createFile(filename, '');
    }

    function getFileIterator(filename) {
        filename = formatExtension(filename);
        return rootFolder.getFilesByName(filename);
    }

    function getJSON(file) {
        return file ? tryParseJSON(file) : [];
    }

    function tryParseJSON(file) {
        try {
            return JSON.parse(file.getBlob().getDataAsString());
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    function getRootFolder() {
        let folders = DriveApp.getFoldersByName(FOLDER_NAME);
        if (folders.hasNext()) {
            return folders.next();
        }
        return DriveApp.createFolder(FOLDER_NAME);
    }

    function formatExtension(filename) {
        if (!filename.includes('.')) {
            filename += '.json';
        }
        return filename;
    }

    function compressTracks(tracks) {
        if (!(tracks && tracks.length > 0 && (tracks[0].album || tracks[0].track))) {
            return;
        }

        tracks.forEach((item) => {
            if (item.track) {
                delete item.context;
                item = item.track;
            }

            delete item.uri;
            delete item.type;
            delete item.track_number;
            delete item.is_local;
            delete item.preview_url;
            delete item.href;
            delete item.external_urls;
            delete item.external_ids;
            delete item.disc_number;
            delete item.available_markets;

            compressAlbum(item.album);
            compressArtists(item.artists);
        });
    }

    function compressAlbum(item) {
        if (!item) {
            return;
        }

        delete item.available_markets;
        delete item.external_urls;
        delete item.href;
        delete item.images;
        delete item.type;
        delete item.uri;
        compressArtists(item.artists);
    }

    function compressArtists(items) {
        if (!items || items.length == 0) {
            return;
        }

        items.forEach((item) => {
            delete item.href;
            delete item.type;
            delete item.uri;
            delete item.external_urls;
        });
    }
})();

const RecentTracks = (function () {
    const SPOTIFY_FILENAME = 'SpotifyRecentTracks.json';
    const LASTFM_FILENAME = 'LastfmRecentTracks.json';
    const BOTH_SOURCE_FILENAME = 'BothRecentTracks.json';
    const TRIGGER_FUCTION_NAME = 'updateRecentTracks';
    const TRIGGER_EVERY_MINUTES = 15;
    const TRACK_ITEMS_LIMIT = 20000;

    if (!ON_SPOTIFY_RECENT_TRACKS && !ON_LASTFM_RECENT_TRACKS) {
        deleteTrigger();
        return;
    }

    if (!hasTrigger()) {
        createTrigger();
    }

    function deleteTrigger() {
        if (hasTrigger()) {
            ScriptApp.deleteTrigger(getTrigger());
        }
    }

    function hasTrigger() {
        return getTrigger();
    }

    function getTrigger() {
        let triggers = ScriptApp.getProjectTriggers();
        for (let i = 0; i < triggers.length; i++) {
            if (TRIGGER_FUCTION_NAME === triggers[i].getHandlerFunction()) {
                return triggers[i];
            }
        }
        return undefined;
    }

    function createTrigger() {
        ScriptApp.newTrigger(TRIGGER_FUCTION_NAME).timeBased().everyMinutes(TRIGGER_EVERY_MINUTES).create();
    }

    function getSpotifyRecentTrackItemsFifty() {
        let url = Utilities.formatString('%s/me/player/recently-played?limit=50', API_BASE_URL);
        return Request.get(url).items;
    }

    function get(limit) {
        let tracks = [];
        if (ON_SPOTIFY_RECENT_TRACKS && ON_LASTFM_RECENT_TRACKS) {
            tracks = Cache.read(BOTH_SOURCE_FILENAME);
        } else if (ON_SPOTIFY_RECENT_TRACKS) {
            tracks = Source.getRecentTracks(TRACK_ITEMS_LIMIT);
        } else if (ON_LASTFM_RECENT_TRACKS) {
            tracks = Cache.read(LASTFM_FILENAME);
        }
        if (limit) {
            Selector.keepFirst(tracks, limit);
        }
        return tracks;
    }

    function getSpotifyRecentTrackItems() {
        return Cache.read(SPOTIFY_FILENAME);
    }

    function updateRecentTracks() {
        if (ON_SPOTIFY_RECENT_TRACKS) {
            updateSpotifyRecentTracks();
        }
        if (ON_LASTFM_RECENT_TRACKS) {
            updateLastfmRecentTracks();
        }
        if (ON_SPOTIFY_RECENT_TRACKS && ON_LASTFM_RECENT_TRACKS) {
            updateBothSourceRecentTracks();
        }
    }

    function updateSpotifyRecentTracks() {
        let recentItems = getSpotifyRecentTrackItemsFifty();
        let fileItems = Cache.read(SPOTIFY_FILENAME);
        let endIndexNewPlayed = getIndexOfNewPlayed(recentItems, fileItems);
        let newItems = recentItems.slice(0, endIndexNewPlayed);
        if (newItems.length > 0) {
            Cache.compressTracks(newItems);
            Cache.append(SPOTIFY_FILENAME, newItems, 'begin', TRACK_ITEMS_LIMIT);
        }
    }

    function updateLastfmRecentTracks() {
        let recentTracks = Lastfm.getRecentTracks(LASTFM_LOGIN, LASTFM_RANGE_RECENT_TRACKS);
        let fileTracks = Cache.read(LASTFM_FILENAME);
        let endIndexNewPlayed = getIndexOfNewPlayed(recentTracks, fileTracks);
        let newTracks = recentTracks.slice(0, endIndexNewPlayed);
        if (newTracks.length > 0) {
            Cache.compressTracks(newTracks);
            Cache.append(LASTFM_FILENAME, newTracks, 'begin', TRACK_ITEMS_LIMIT);
        }
    }

    function updateBothSourceRecentTracks() {
        let spotifyTracks = Source.getRecentTracks(TRACK_ITEMS_LIMIT);
        let lastfmTracks = Cache.read(LASTFM_FILENAME);
        Combiner.push(spotifyTracks, lastfmTracks);
        Filter.dedupTracks(spotifyTracks);
        spotifyTracks.sort((x, y) => Order.compareDate(y.played_at, x.played_at));
        Cache.write(BOTH_SOURCE_FILENAME, spotifyTracks);
    }

    function getIndexOfNewPlayed(recentItems, fileItems) {
        if (fileItems.length == 0) {
            return recentItems.length;
        }

        let lastPlayedTime = fileItems[0].played_at;
        for (let i = recentItems.length - 1; i >= 0; i--) {
            if (recentItems[i].played_at === lastPlayedTime) {
                return i;
            }
        }
        return recentItems.length;
    }

    function compress() {
        if (ON_SPOTIFY_RECENT_TRACKS && Cache.copy(SPOTIFY_FILENAME)) {
            compressFile(SPOTIFY_FILENAME);
        }
        if (ON_LASTFM_RECENT_TRACKS && Cache.copy(LASTFM_FILENAME)) {
            compressFile(LASTFM_FILENAME);
        }
        if (ON_SPOTIFY_RECENT_TRACKS && ON_LASTFM_RECENT_TRACKS && Cache.copy(BOTH_SOURCE_FILENAME)) {
            compressFile(BOTH_SOURCE_FILENAME);
        }
    }

    function compressFile(filename) {
        let tracks = Cache.read(filename);
        Cache.compressTracks(tracks);
        Cache.write(filename, tracks);
    }

    return {
        updateRecentTracks: updateRecentTracks,
        getRecentTrackItems: getSpotifyRecentTrackItems,
        compress: compress,
        get: get,
    };
})();

const Source = (function () {
    const TOP_RANGE = ['short', 'medium', 'long'];

    function getTopTracks(strTopRange) {
        if (!strTopRange || !TOP_RANGE.includes(strTopRange)) {
            strTopRange = 'medium';
        }

        // Баг со стороны Spotify: https://community.spotify.com/t5/Spotify-for-Developers/Bug-with-offset-for-method-quot-Get-User-s-Top-Artists-and/td-p/5032362
        // Максимум можно получить топ-98
        // При limit = 50 и offset = 50, next = null
        // При limit = 49 и offset = 49, next != null
        // При limit = 49 и offset = 98, next = null

        // Получить топ-90
        let limit = 45;
        let path = Utilities.formatString('me/top/tracks?limit=%s&time_range=%s_term', limit, strTopRange);
        return Request.getItemsByPath(path, 2);
    }

    function getRecomTracks(queryObj) {
        if (!queryObj.limit || queryObj > 100) {
            queryObj.limit = 100;
        }
        if (!queryObj.market) {
            queryObj.market = 'from_token';
        }
        let query = Request.parseQuery(queryObj);
        let url = Utilities.formatString('%s/recommendations?limit=100&%s', API_BASE_URL, query);
        return Request.get(url).tracks;
    }

    function getRecentTracks(limit = 200) {
        let tracks = extractTracks(RecentTracks.getRecentTrackItems());
        return Selector.sliceFirst(tracks, limit);
    }

    function getFollowedTracks(params) {
        if (!params) params = {};
        let items = getFollowedItems(params.type, params.userId, params.exclude);
        if (params.limit) {
            Selector.keepRandom(items, params.limit);
        }
        return getTracks(items);
    }

    function getTracksArtists(params) {
        let artists = getArtists(params.artist);
        params.album = params.album ? params.album : {};
        let albums = getArtistsAlbums(artists, params.album);
        let tracks = [];
        albums.forEach((album) => Combiner.push(tracks, getAlbumTracks(album, params.album.track_limit)));
        return tracks;
    }

    function getArtists(paramsArtist) {
        let artists = [];
        if (paramsArtist.include) {
            Combiner.push(artists, getArtistsById(paramsArtist.include));
        }
        if (paramsArtist.followed_include) {
            Combiner.push(artists, getFollowedArtists());
        }
        if (paramsArtist.exclude) {
            let excludeIds = paramsArtist.exclude.map((item) => item.id);
            artists = artists.filter((item) => !excludeIds.includes(item.id));
        }
        artists = artists.filter((artist) => {
            if (artist.followers && typeof artist.followers === 'object') {
                artist.followers = artist.followers.total;
            }
            return (
                RangeTracks.isBelong(artist, paramsArtist) &&
                RangeTracks.isBelongGenres(artist.genres, paramsArtist.genres) &&
                !RangeTracks.isBelongBanGenres(artist.genres, paramsArtist.ban_genres)
            );
        });
        if (paramsArtist.artist_limit) {
            Selector.keepRandom(artists, paramsArtist.artist_limit);
        }
        return artists;
    }

    function getArtistsById(artistsArray) {
        let ids = artistsArray.map((item) => item.id);
        return Request.getFullObjByIds('artists', ids, 50);
    }

    function getFollowedArtists() {
        return Request.getItemsByPath('me/following?type=artist&limit=50');
    }

    function getArtistsAlbums(artists, paramsAlbum) {
        let albums = [];
        let groups = paramsAlbum.groups ? paramsAlbum.groups : 'album,single';
        artists.forEach((artist) => {
            let path = Utilities.formatString('artists/%s/albums?country=from_token&include_groups=%s&limit=50', artist.id, groups);
            Combiner.push(albums, Request.getItemsByPath(path));
        });
        albums = albums.filter((album) => RangeTracks.isBelongReleaseDate(album.release_date, paramsAlbum.release_date));
        if (paramsAlbum.album_limit) {
            Selector.keepRandom(albums, paramsAlbum.limit);
        }
        return albums;
    }

    function getAlbumTracks(album, limit) {
        let path = Utilities.formatString('albums/%s/tracks', album.id);
        let items = Request.getItemsByPath(path);
        if (limit) {
            Selector.keepRandom(items, limit);
        }
        items.forEach((item) => (item.album = album));
        return items;
    }

    function getSavedAlbumTracks(limit) {
        let items = getSavedAlbumItems();
        if (limit) {
            Selector.keepRandom(items, limit);
        }
        return extractAlbumTracks(items);
    }

    function extractAlbumTracks(source) {
        let tracks = [];
        source.forEach((item) => Combiner.push(tracks, item.tracks.items));
        return tracks;
    }

    function getSavedAlbumItems() {
        let albumItems = Request.getItemsByPath('me/albums?limit=50', 400);
        return albumItems.map((item) => {
            let added_at = item.added_at;
            item = item.album;
            item.added_at = added_at;
            return item;
        });
    }

    function getFollowedItems(type = 'followed', userId = User.getId(), excludePlaylist) {
        let playlistArray = Playlist.getPlaylistArray(userId);
        if (type != 'all') {
            playlistArray = playlistArray.filter((playlist) => {
                let owned = playlist.owner.id == userId;
                return type == 'owned' ? owned : !owned;
            });
        }
        if (excludePlaylist) {
            let ids = excludePlaylist.map((item) => item.id);
            playlistArray = playlistArray.filter((item) => !ids.includes(item.id));
        }
        return playlistArray;
    }

    function getTracksRandom(playlistArray, countPlaylist = 1) {
        return getTracks(Selector.sliceRandom(playlistArray, countPlaylist));
    }

    function getPlaylistTracks(name, id, userId) {
        return getTracks([{ id: id, name: name, userId: userId }]);
    }

    function getTracks(playlistArray) {
        return extractTracks(getTrackItems(playlistArray));
    }

    function getTrackItems(playlistArray) {
        return playlistArray.reduce((items, playlist) => {
            let playlistItems = [];
            if (playlist.id) {
                playlistItems = getItemsByPlaylistId(playlist.id);
            } else if (playlist.name) {
                playlistItems = getItemsByPlaylistName(playlist.name, playlist.userId);
            }
            return Combiner.push(items, playlistItems);
        }, []);
    }

    function getItemsByPlaylistId(playlistId) {
        let playlist = Playlist.getById(playlistId);
        return getItemsByPlaylistObject(playlist);
    }

    function getItemsByPlaylistName(playlistName, userId) {
        let playlist = Playlist.getByName(playlistName, userId);
        if (!playlist || !playlist.id) {
            return [];
        }
        return getItemsByPlaylistId(playlist.id);
    }

    function getItemsByPlaylistObject(obj) {
        if (obj && obj.tracks.total > 100) {
            return Request.getItemsByNext(obj.tracks);
        }
        return obj ? obj.tracks.items : [];
    }

    function getSavedTracks() {
        return extractTracks(getSavedItems());
    }

    const getSavedItems = (function () {
        let savedItems;
        return getItems;

        function getItems() {
            if (!savedItems) {
                savedItems = Request.getItemsByPath('me/tracks?limit=50', 400);
            }
            return savedItems;
        }
    })();

    function extractTracks(items) {
        if (!items || items.length == 0) {
            return [];
        }

        let key = items[0].played_at ? 'played_at' : 'added_at';
        return items.reduce((tracks, item) => {
            if ((!item.hasOwnProperty('is_local') || !item.is_local) && item.track && item.track.artists && item.track.artists.length > 0) {
                let date = item[key] ? item[key] : new Date('2000-01-01').toISOString();
                item.track[key] = date;
                tracks.push(item.track);
            }
            return tracks;
        }, []);
    }

    function searchTrack(trackname) {
        return searchBestMatch(trackname, 'track');
    }

    function searchArtist(artistname) {
        return searchBestMatch(artistname, 'artist');
    }

    function searchBestMatch(text, type) {
        let query = Request.parseQuery({
            q: text,
            type: type,
            limit: '1',
        });
        let url = Utilities.formatString('%s/search/?%s', API_BASE_URL, query);
        let response = Request.get(url);
        let items = response.items;
        return items[0] ? items[0] : {};
    }

    return {
        getTracks: getTracks,
        getTracksRandom: getTracksRandom,
        getPlaylistTracks: getPlaylistTracks,
        getTopTracks: getTopTracks,
        getRecentTracks: getRecentTracks,
        getFollowedTracks: getFollowedTracks,
        getTracksArtists: getTracksArtists,
        getSavedTracks: getSavedTracks,
        getSavedAlbumTracks: getSavedAlbumTracks,
        getRecomTracks: getRecomTracks,
        searchTrack: searchTrack,
        searchArtist: searchArtist,
    };
})();

const Request = (function () {
    let countRequest = 0;
    function getCountRequest() {
        return countRequest;
    }

    function getItemsByPath(urlPath, limitRequestCount) {
        let url = Utilities.formatString('%s/%s', API_BASE_URL, urlPath);
        let response = get(url);
        return getItemsByNext(response, limitRequestCount);
    }

    function getItemsByNext(response, limitRequestCount = 220) {
        let items = response.items;
        let count = 1;
        while (response.next != null && count != limitRequestCount) {
            response = get(response.next);
            Combiner.push(items, response.items);
            count++;
        }
        return items;
    }

    function getFullObjByIds(objType, ids, limit) {
        let requestCount = Math.ceil(ids.length / limit);
        let fullObj = [];
        for (let i = 0; i < requestCount; i++) {
            let strIds = ids.splice(0, limit).join(',');
            let url = Utilities.formatString('%s/%s/?ids=%s', API_BASE_URL, objType, strIds);
            let response = get(url);
            //let key = Object.keys(response)[0]; // tracks or artists or albums or audio_features
            //Combiner.push(fullObj, response[key]);
            Combiner.push(fullObj, response);
        }
        return fullObj;
    }

    function get(url) {
        let response = fetch(url);
        let keys = Object.keys(response);
        if (keys.length == 1 && !response.items) {
            response = response[keys[0]]; // tracks or artists or albums or audio_features
        }
        return response;
    }

    function post(url, payload) {
        return fetch(url, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
        });
    }

    function deleteRequest(url, payload) {
        return fetch(url, {
            method: 'delete',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
        });
    }

    function put(url, payload) {
        return fetch(url, {
            method: 'put',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
        });
    }

    function putImage(url, imgBytes) {
        return fetch(url, {
            method: 'put',
            contentType: 'image/jpeg',
            payload: Utilities.base64Encode(imgBytes),
        });
    }

    function putIds(url, ids, limit) {
        for (let i = 0; i < Math.ceil(ids.length / limit); i++) {
            put(url, { ids: ids.splice(0, limit) });
        }
    }

    function deleteIds(url, ids, limit) {
        for (let i = 0; i < Math.ceil(ids.length / limit); i++) {
            deleteRequest(url, { ids: ids.splice(0, limit) });
        }
    }

    function fetch(url, params = {}) {
        countRequest++;
        params.headers = getHeaders();
        params.muteHttpExceptions = true;
        let response = UrlFetchApp.fetch(url, params);
        if (response.getResponseCode() == 429) {
            let seconds = response.getHeaders()['Retry-After'];
            console.error('Превышен лимит запросов. Пауза', seconds, 'секунд и повторная отправка');
            Utilities.sleep(seconds * 1000);
            return fetch(url, params);
        } else if (response.getResponseCode() > 300) {
            console.error('Ошибка при запросе', response.getResponseCode(), url, response.getContentText(), params);
            return;
        }
        return parseJSON(response);
    }

    function getHeaders() {
        return {
            Authorization: 'Bearer ' + Auth.getAccessToken(),
        };
    }

    function parseJSON(response) {
        let content = response.getContentText();
        return content.length > 0 ? tryParseJSON(content) : { msg: 'Пустое тело ответа', status: response.getResponseCode() };
    }

    function tryParseJSON(content) {
        try {
            return JSON.parse(content);
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    function parseQuery(obj) {
        return Object.keys(obj)
            .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`)
            .join('&');
    }

    return {
        get: get,
        getItemsByPath: getItemsByPath,
        getItemsByNext: getItemsByNext,
        getFullObjByIds: getFullObjByIds,
        getCountRequest: getCountRequest,
        post: post,
        put: put,
        putImage: putImage,
        putIds: putIds,
        deleteIds: deleteIds,
        parseQuery: parseQuery,
        parseJSON: parseJSON,
    };
})();

const RangeTracks = (function () {
    const BAN_KEYS = [
        'genres',
        'release_date',
        'followed_include',
        'include',
        'exclude',
        'groups',
        'release_date',
        'artist_limit',
        'album_limit',
        'track_limit',
    ];

    let _cachedTracks;
    let _lastOutRange;
    let _args;

    return {
        rangeTracks: rangeTracks,
        getLastOutRange: getLastOutRange,
        isBelong: isBelong,
        isBelongGenres: isBelongGenres,
        isBelongBanGenres: isBelongBanGenres,
        isBelongReleaseDate: isBelongReleaseDate,
    };

    function getLastOutRange() {
        return _lastOutRange ? _lastOutRange.slice() : [];
    }

    function rangeTracks(tracks, args) {
        _args = args;
        _lastOutRange = [];
        _cachedTracks = getCachedTracks(tracks, args);

        let filteredTracks = tracks.filter((track) => {
            if (isBelongMeta(track) && isBelongFeatures(track) && isBelongArtist(track) && isBelongAlbum(track)) {
                return true;
            } else {
                _lastOutRange.push(track);
                return false;
            }
        });

        Combiner.replace(tracks, filteredTracks);
    }

    function isBelongMeta(track) {
        if (!_args.meta) {
            return true;
        }

        let trackMeta = _cachedTracks.meta[track.id] ? _cachedTracks.meta[track.id] : track;
        return _args.meta ? isBelong(trackMeta, _args.meta) : true;
    }

    function isBelongFeatures(track) {
        if (!_args.features) {
            return true;
        }

        let trackFeatures = _cachedTracks.features[track.id];
        return isBelong(trackFeatures, _args.features);
    }

    function isBelongArtist(track) {
        if (!_args.artist) {
            return true;
        }

        let trackArtist;
        if (_cachedTracks.artists[track.artists[0].id]) {
            trackArtist = _cachedTracks.artists[track.artists[0].id];
        } else {
            trackArtist = track.artists[0];
        }

        if (trackArtist.followers && typeof trackArtist.followers === 'object') {
            trackArtist.followers = trackArtist.followers.total;
        }
        return (
            isBelong(trackArtist, _args.artist) &&
            isBelongGenres(trackArtist.genres, _args.artist.genres) &&
            !isBelongBanGenres(trackArtist.genres, _args.artist.ban_genres)
        );
    }

    function isBelongAlbum(track) {
        if (!_args.album) {
            return true;
        }

        let trackAlbum;
        if (_cachedTracks.albums[track.album.id]) {
            trackAlbum = _cachedTracks.albums[track.album.id];
        } else {
            trackAlbum = track.album;
        }

        return (
            isBelong(trackAlbum, _args.albums) &&
            isBelongGenres(trackAlbum.genres, _args.album.genres) &&
            !isBelongBanGenres(trackAlbum.genres, _args.album.ban_genres) &&
            isBelongReleaseDate(trackAlbum.release_date, _args.album.release_date)
        );
    }

    function isBelongReleaseDate(albumReleaseDate, targetPeriod) {
        if (!targetPeriod) {
            return true;
        }

        let releaseDate = new Date(albumReleaseDate);
        let startDate, endDate;
        if (targetPeriod.sinceDays) {
            startDate = Filter.getDateRel(targetPeriod.sinceDays, 'startDay');
            endDate = Filter.getDateRel(targetPeriod.beforeDays, 'endDay');
        } else if (targetPeriod.startDate) {
            startDate = targetPeriod.startDate;
            endDate = targetPeriod.endDate;
        }
        if (releaseDate < startDate || releaseDate > endDate) {
            return false;
        }
        return true;
    }

    function isBelongGenres(objGeners, selectedGenres) {
        if (!selectedGenres || selectedGenres.length == 0) {
            return true;
        }
        return isSomeIncludes(objGeners, selectedGenres);
    }

    function isBelongBanGenres(objGeners, banGenres) {
        if (!banGenres || banGenres.length == 0) {
            return false;
        }
        return isSomeIncludes(objGeners, banGenres);
    }

    function isSomeIncludes(targetArray, valueArray) {
        return valueArray.some((str) => {
            return targetArray.some((item) => item.includes(str));
        });
    }

    function isBelong(obj, args) {
        if (!obj) {
            return false;
        }
        for (let key in args) {
            if ((typeof obj[key] === 'boolean' && !obj[key]) || BAN_KEYS.includes(key)) {
                // explicit == false, key == genres, key == ban_genres, key = release_date, key = followed_include
                continue;
            }

            if (typeof args[key] == 'object' && (obj[key] < args[key].min || obj[key] > args[key].max)) {
                return false;
            } else if (typeof args[key] != 'object' && args[key] != obj[key]) {
                return false;
            }
        }
        return true;
    }
})();

const Filter = (function () {
    function removeTracks(sourceArray, removedArray, invert = false) {
        let removedIds = removedArray.map((item) => item.id);
        let removedNames = removedArray.map((item) => getTrackKey(item));
        let filteredTracks = sourceArray.filter((item) => {
            return invert ^ (!removedIds.includes(item.id) && !removedNames.includes(getTrackKey(item)));
        });
        Combiner.replace(sourceArray, filteredTracks);
    }

    function removeArtists(sourceArray, removedArray, invert = false) {
        let removedIds = removedArray.map((item) => item.artists[0].id);
        let filteredTracks = sourceArray.filter((item) => {
            return invert ^ !removedIds.includes(item.artists[0].id);
        });
        Combiner.replace(sourceArray, filteredTracks);
    }

    function getTrackKey(track) {
        return Utilities.formatString('%s:%s', track.name, track.artists[0].name).toLowerCase();
    }

    function matchExceptMix(tracks) {
        matchExcept(tracks, 'mix|club');
    }

    function matchExceptRu(tracks) {
        matchExcept(tracks, '^[а-яА-Я0-9]+');
    }

    function matchLatinOnly(tracks) {
        match(tracks, '^[a-zA-Z0-9]+');
    }

    function matchOriginalOnly(tracks) {
        matchExcept(tracks, 'mix|club|radio|piano|acoustic|edit|live|version|cover');
    }

    function matchExcept(tracks, strRegex) {
        match(tracks, strRegex, true);
    }

    function match(tracks, strRegex, invert = false) {
        let regex = new RegExp(strRegex, 'i');
        let filteredTracks = tracks.filter((track) => {
            return invert ^ (regex.test(track.name) || regex.test(track.album.name));
        });
        Combiner.replace(tracks, filteredTracks);
    }

    function rangeDateRel(tracks, sinceDays, beforeDays) {
        extractTracksRel(tracks, sinceDays, beforeDays);
    }

    function rangeDateAbs(tracks, startDate, endDate) {
        extractTracksAbs(tracks, startDate, endDate);
    }

    function extractTracksRel(items, sinceDays, beforeDays) {
        let startDate = getDateRel(sinceDays, 'startDay');
        let endDate = getDateRel(beforeDays, 'endDay');
        extractTracksAbs(items, startDate, endDate);
    }

    function extractTracksAbs(items, startDate, endDate) {
        if (!items) {
            console.error('items is null', items);
            return;
        }

        let startTime = startDate ? startDate.getTime() : Date.now();
        let endTime = endDate ? endDate.getTime() : Date.now();

        if (startTime >= endTime) {
            console.error('Начальная граница больше, чем конечная граница:', startDate, endDate);
            return;
        }

        let filteredTracks = items.reduce((tracks, track) => {
            let key = track.played_at ? 'played_at' : 'added_at';
            let date = track[key] ? new Date(track[key]) : new Date('2000-01-01');
            let time = date.getTime();
            if (time >= startTime && time <= endTime) {
                tracks.push(track);
            }
            return tracks;
        }, []);

        Combiner.replace(items, filteredTracks);
    }

    function getDateRel(days, bound) {
        let date = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : new Date();
        if (bound == 'startDay') {
            date.setHours(0, 0, 0, 0);
        } else if (bound == 'endDay') {
            date.setHours(23, 59, 59, 999);
        }
        return date;
    }

    const Deduplicator = (function () {
        const TYPE_TRACKS = 'tracks';
        const TYPE_ARTISTS = 'artists';

        let _tracks;
        let _duplicates;

        function dedupTracks(tracks) {
            dedup(tracks, TYPE_TRACKS);
        }

        function dedupArtists(tracks) {
            dedup(tracks, TYPE_ARTISTS);
        }

        function separateArtistsDuplicated(tracks) {
            _tracks = tracks;
            _duplicates = findArtistsDuplicated();
            let indexArray = _duplicates.map((item) => item.index);
            let result = { original: [], duplicate: [] };
            for (let i = 0; i < _tracks.length; i++) {
                let key = indexArray.includes(i) ? 'duplicate' : 'original';
                result[key].push(_tracks[i]);
            }
            return result;
        }

        function dedup(tracks, type) {
            _tracks = tracks;
            _duplicates = type == TYPE_ARTISTS ? findArtistsDuplicated() : findTracksDuplicated();
            removeTracksDuplicated();
        }

        function findTracksDuplicated() {
            const seenIds = {};
            const seenTrackKeys = {};
            return _tracks.reduce((duplicates, track, index) => {
                if (track === null || track.id === null) {
                    return duplicates;
                }

                if (isDuplicateByTrackId(track.id) || isDuplicateByName(track)) {
                    duplicates.push({
                        index: index,
                        track: track,
                        reason: track.id in seenIds ? 'same-track-id' : 'same-track-name',
                    });
                } else {
                    seenIds[track.id] = true;
                    const trackKey = getTrackKey(track);
                    seenTrackKeys[trackKey] = seenTrackKeys[trackKey] || [];
                    seenTrackKeys[trackKey].push(track.duration_ms);
                }

                function isDuplicateByTrackId(id) {
                    return id in seenTrackKeys;
                }

                function isDuplicateByName(track) {
                    const trackKey = getTrackKey(track);
                    return (
                        trackKey in seenTrackKeys &&
                        0 != seenTrackKeys[trackKey].filter((duration) => Math.abs(duration - track.duration_ms) < 2000).length
                    );
                }

                return duplicates;
            }, []);
        }

        function findArtistsDuplicated() {
            const seenArtists = {};
            return _tracks.reduce((duplicates, track, index) => {
                if (
                    track === null ||
                    track.id === null ||
                    track.artists === null ||
                    track.artists.length == 0 ||
                    track.artists[0].id === null
                ) {
                    return duplicates;
                }

                const artistId = getArtistId(track);
                if (isDuplicateByArtistId(artistId)) {
                    duplicates.push({
                        index: index,
                        track: track,
                        reason: 'same-artist-id',
                    });
                } else {
                    seenArtists[artistId] = true;
                }

                return duplicates;

                function getArtistId(track) {
                    return track.artists[0].id;
                }

                function isDuplicateByArtistId(artistId) {
                    return artistId in seenArtists;
                }
            }, []);
        }

        function removeTracksDuplicated() {
            let offset = 0;
            _duplicates.forEach((item) => {
                _tracks.splice(item.index - offset, 1);
                offset++;
            });
        }

        return {
            dedupTracks: dedupTracks,
            dedupArtists: dedupArtists,
            separateArtistsDuplicated: separateArtistsDuplicated,
        };
    })();

    return {
        removeTracks: removeTracks,
        removeArtists: removeArtists,
        dedupTracks: Deduplicator.dedupTracks,
        dedupArtists: Deduplicator.dedupArtists,
        getDateRel: getDateRel,
        rangeDateRel: rangeDateRel,
        rangeDateAbs: rangeDateAbs,
        rangeTracks: RangeTracks.rangeTracks,
        getLastOutRange: RangeTracks.getLastOutRange,
        match: match,
        matchExcept: matchExcept,
        matchExceptRu: matchExceptRu,
        matchExceptMix: matchExceptMix,
        matchLatinOnly: matchLatinOnly,
        matchOriginalOnly: matchOriginalOnly,
        separateArtistsDuplicated: Deduplicator.separateArtistsDuplicated,
    };
})();

const Combiner = (function () {
    function replace(oldArray, newArray) {
        oldArray.length = 0;
        push(oldArray, newArray);
    }

    function push(sourceArray, ...additionalArray) {
        additionalArray.forEach((array) => {
            if (array.length < 1000) {
                sourceArray.push.apply(sourceArray, array);
            } else {
                array.forEach((item) => sourceArray.push(item));
            }
        });
        return sourceArray;
    }

    const Alternation = (function () {
        function alternate(bound, ...arrays) {
            let limitLength = getLimitLength(bound, arrays);
            let resultArray = [];
            for (let i = 0; i < limitLength; i++) {
                arrays.forEach((item) => {
                    if (item[i]) resultArray.push(item[i]);
                });
            }
            return resultArray;
        }

        function getLimitLength(type, arrays) {
            let lengthArray = arrays.map((item) => item.length);
            let mathMethod = type == 'min' ? Math.min : Math.max;
            return mathMethod(...lengthArray);
        }

        function mixin(xArray, yArray, xRow, yRow, toLimitOn) {
            let resultArray = [];
            let limitLength = getLimitLength('max', [xArray, yArray]);
            for (let i = 0; i < limitLength; i++) {
                let xStartIndex = i * xRow;
                let xEndIndex = xStartIndex + xRow;
                push(resultArray, xArray.slice(xStartIndex, xEndIndex));

                let yStartIndex = i * yRow;
                let yEndIndex = yStartIndex + yRow;
                push(resultArray, yArray.slice(yStartIndex, yEndIndex));

                if (toLimitOn && !(xArray[(i + 1) * xRow] && yArray[(i + 1) * yRow])) {
                    break;
                }
            }
            return resultArray;
        }

        return {
            alternate: alternate,
            mixin: mixin,
        };
    })();

    return {
        alternate: Alternation.alternate,
        mixin: Alternation.mixin,
        replace: replace,
        push: push,
    };
})();

const Playlist = (function () {
    const LIMIT_TRACKS = 11000;
    const LIMIT_DESCRIPTION = 300;
    const SIZE = ['500', '600', '700', '800', '900', '1000'];

    function getById(playlistId) {
        let url = Utilities.formatString('%s/playlists/%s', API_BASE_URL, playlistId);
        return Request.get(url);
    }

    function getByName(playlistName, userId) {
        let path = userId == null ? 'me/playlists?limit=50' : Utilities.formatString('users/%s/playlists?limit=50', userId);
        let url = Utilities.formatString('%s/%s', API_BASE_URL, path);
        let response = Request.get(url);
        while (true) {
            let foundItem = response.items.find((item) => {
                return item.name == playlistName;
            });
            if (!foundItem && response.next) {
                response = Request.get(response.next);
            } else {
                return foundItem;
            }
        }
    }

    function getDescription(tracks, limit = 5) {
        let copyTracks = Selector.sliceCopy(tracks);
        Filter.dedupArtists(copyTracks);
        let artists = Selector.sliceRandom(copyTracks, limit);
        let strArtists = artists.map((track) => track.artists[0].name).join(', ');
        return Utilities.formatString('%s и не только', strArtists);
    }

    const getPlaylistArray = (function () {
        let playlistsOfUsers = {};
        return get;

        function get(userId) {
            let key = userId == null ? 'me' : userId;
            if (playlistsOfUsers[key] == null) {
                let path = userId == null ? 'me/playlists?limit=50' : Utilities.formatString('users/%s/playlists?limit=50', userId);
                playlistsOfUsers[key] = Request.getItemsByPath(path);
            }
            return playlistsOfUsers[key];
        }
    })();

    function create(payload) {
        let url = Utilities.formatString('%s/users/%s/playlists', API_BASE_URL, User.getId());
        return Request.post(url, payload);
    }

    function saveAsNew(data) {
        let payload = createPayload(data);
        let createdPlaylist = create(payload);

        addTracks({
            id: createdPlaylist.id,
            tracks: data.tracks,
        });

        if (data.hasOwnProperty('randomCover')) {
            setRandomCover(createdPlaylist.id);
        }
    }

    function saveWithReplace(data) {
        saveWithModify(replaceTracks, data);
    }

    function saveWithAppend(data) {
        saveWithModify(addTracks, data);
    }

    function saveWithModify(modifyMethod, data) {
        if (data.id) {
            modifyMethod(data);
            changeDetails(data);
            changeCover(data);
            return;
        }

        let response = getByName(data.name);
        if (response == null) {
            saveAsNew(data);
        } else {
            data.id = response.id;
            saveWithModify(modifyMethod, data);
        }
    }

    function addTracks(data) {
        modifyTracks('post', data);
    }

    function replaceTracks(data) {
        modifyTracks('put', data);
    }

    function modifyTracks(requestType, data) {
        if (data.tracks.length > LIMIT_TRACKS) {
            Selector.keepFirst(data.tracks, LIMIT_TRACKS);
        }
        let size = 100;
        let uris = getTrackUris(data.tracks);
        let count = Math.ceil(uris.length / size);
        let url = Utilities.formatString('%s/playlists/%s/tracks', API_BASE_URL, data.id);
        if (count == 0 && requestType == 'put') {
            // Удалить треки в плейлисте
            Request.put(url, { uris: [] });
            return;
        }

        for (let i = 0; i < count; i++) {
            let begin = i * size;
            let end = begin + size;
            let payload = { uris: uris.slice(begin, end) };
            if (!data.toEnd && requestType === 'post') {
                // добавлять треки вначало плейлиста со смещением begin, чтобы сохранить оригинальную сортировку
                payload.position = begin;
            }

            if (requestType === 'post') {
                // post-запрос добавляет треки в плейлист
                Request.post(url, payload);
            } else if (requestType === 'put') {
                // put-запрос заменяет все треки плейлиста
                Request.put(url, payload);
                // сменить тип запроса, чтобы добавлять остальные треки
                requestType = 'post';
            }
        }
    }

    function getTrackUris(tracks) {
        return tracks.reduce((uris, track) => {
            let uri = track.uri;
            if (!uri) {
                uri = Utilities.formatString('spotify:track:%s', track.id);
            }
            uris.push(uri);
            return uris;
        }, []);
    }

    function changeDetails(data) {
        let url = Utilities.formatString('%s/playlists/%s', API_BASE_URL, data.id);
        let payload = createPayload(data);
        Request.put(url, payload);
    }

    function changeCover(data) {
        if (data.randomCover == 'update' || (data.randomCover == 'once' && hasMosaicCover(data.id))) {
            setRandomCover(data.id);
        }
    }

    function hasMosaicCover(playlistId) {
        let playlist = getById(playlistId);
        return playlist.images.length > 0 && playlist.images[0].url.includes('mosaic');
    }

    function getRandomSize() {
        let index = Math.floor(Math.random() * SIZE.length);
        return SIZE[index];
    }

    function getRandomCover() {
        let img = UrlFetchApp.fetch('https://picsum.photos/' + getRandomSize());
        //if (img.getContent().length > 250000) {
        if (img.getAllHeaders()['content-length'] > 250000) {
            // ~ 250 kb
            return getRandomCover();
        }
        return img.getContent();
    }

    function setRandomCover(playlistId) {
        let url = Utilities.formatString('%s/playlists/%s/images', API_BASE_URL, playlistId);
        Request.putImage(url, getRandomCover());
    }

    function createPayload(data) {
        let payload = {
            name: data.name,
            public: data.hasOwnProperty('public') ? data.public : true,
        };
        if (data.description) {
            payload.description = data.description;
        }
        return payload;
    }

    return {
        getById: getById,
        getByName: getByName,
        getDescription: getDescription,
        getPlaylistArray: getPlaylistArray,
        saveAsNew: saveAsNew,
        saveWithReplace: saveWithReplace,
        saveWithAppend: saveWithAppend,
    };
})();

const Selector = (function () {
    function keepFirst(array, count) {
        Combiner.replace(array, sliceFirst(array, count));
    }

    function keepLast(array, count) {
        Combiner.replace(array, sliceLast(array, count));
    }

    function keepAllExceptFirst(array, skipCount) {
        Combiner.replace(array, sliceAllExceptFirst(array, skipCount));
    }

    function keepAllExceptLast(array, skipCount) {
        Combiner.replace(array, sliceAllExceptLast(array, skipCount));
    }

    function keepRandom(array, count) {
        Order.shuffle(array);
        keepFirst(array, count);
    }

    function keepNoLongerThan(tracks, minutes) {
        Combiner.replace(tracks, sliceNoLongerThan(tracks, minutes));
    }

    function sliceFirst(array, count) {
        return array.slice(0, count);
    }

    function sliceLast(array, count) {
        let startIndex = getLimitIndexForLast(array, count);
        return array.slice(startIndex);
    }

    function sliceAllExceptFirst(array, skipCount) {
        return array.slice(skipCount);
    }

    function sliceAllExceptLast(array, skipCount) {
        let endIndex = getLimitIndexForLast(array, skipCount);
        return array.slice(0, endIndex);
    }

    function getLimitIndexForLast(array, count) {
        return array.length < count ? 0 : array.length - count;
    }

    function sliceRandom(array, count) {
        let copyArray = sliceCopy(array);
        Order.shuffle(copyArray);
        return sliceFirst(copyArray, count);
    }

    function sliceCopy(array) {
        return array.slice();
    }

    function sliceNoLongerThan(tracks, minutes) {
        let totalDuration = minutes * 60 * 1000;
        let currentDuration = 0;
        let resultTracks = [];
        tracks.forEach((track) => {
            let checkDuration = currentDuration + track.duration_ms;
            if (checkDuration <= totalDuration) {
                resultTracks.push(track);
                currentDuration = checkDuration;
            }
        });
        return resultTracks;
    }

    function isWeekend() {
        return isDayOfWeek('saturday') || isDayOfWeek('sunday');
    }

    function isDayOfWeekRu(strDay) {
        return isDayOfWeek(strDay, 'ru-RU');
    }

    function isDayOfWeek(strDay, locale = 'en-US') {
        let today = new Date();
        let strWeekday = today.toLocaleDateString(locale, { weekday: 'long' });
        return strDay.toLowerCase() === strWeekday.toLowerCase();
    }

    return {
        keepFirst: keepFirst,
        keepLast: keepLast,
        keepAllExceptFirst: keepAllExceptFirst,
        keepAllExceptLast: keepAllExceptLast,
        keepRandom: keepRandom,
        keepNoLongerThan: keepNoLongerThan,

        sliceFirst: sliceFirst,
        sliceLast: sliceLast,
        sliceAllExceptFirst: sliceAllExceptFirst,
        sliceAllExceptLast: sliceAllExceptLast,
        sliceRandom: sliceRandom,
        sliceNoLongerThan: sliceNoLongerThan,
        sliceCopy: sliceCopy,

        isWeekend: isWeekend,
        isDayOfWeekRu: isDayOfWeekRu,
        isDayOfWeek: isDayOfWeek,
    };
})();

const Order = (function () {
    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            let j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    function reverse(array) {
        array.reverse();
    }

    const sort = (function () {
        let _tracks;
        let _key;

        return function (tracks, pathKey, direction = 'asc') {
            _tracks = tracks;
            _key = pathKey.split('.')[1];
            if (pathKey.includes('artist')) {
                sortArtist();
            } else if (pathKey.includes('features')) {
                sortFeatures();
            } else if (pathKey.includes('album')) {
                sortAlbum();
            } else if (pathKey.includes('meta')) {
                sortMeta();
            }

            if (direction === 'desc') {
                _tracks.reverse();
            }
        };

        function sortArtist() {
            // popularity, followers, name
            let items = getCachedTracks(_tracks, { artist: {} }).artists;

            if (_key == 'followers') {
                for (let trackArtist in items) {
                    if (trackArtist.followers && typeof trackArtist.followers === 'object') {
                        trackArtist.followers = trackArtist.followers.total;
                    }
                }
            }

            let compareMethod = _key == 'name' ? compareString : compareNumber;
            _tracks.sort((x, y) => compareMethod(items[x.artists[0].id], items[y.artists[0].id]));
        }

        function sortFeatures() {
            // acousticness, danceability, energy, instrumentalness, liveness,
            // loudness, speechiness, valence, tempo, key, mode, time_signature, duration_ms
            let items = getCachedTracks(_tracks, { features: {} }).features;
            _tracks.sort((x, y) => compareNumber(items[x.id], items[y.id]));
        }

        function sortMeta() {
            // name, popularity, duration_ms, explicit, added_at
            if (_key == 'name') {
                _tracks.sort((x, y) => compareString(x, y));
            } else if (_key == 'added_at' || _key == 'played_at') {
                _tracks.sort((x, y) => compareDate(x[_key], y[_key]));
            } else {
                _tracks.sort((x, y) => compareNumber(x, y));
            }
        }

        function sortAlbum() {
            // popularity, name
            let items = getCachedTracks(_tracks, { album: {} }).albums;
            _tracks.sort((x, y) => items[x.album.id][_key] - items[y.album.id][_key]);
        }

        function compareNumber(x, y) {
            return x[_key] - y[_key];
        }

        function compareString(x, y) {
            return (x[_key] > y[_key]) - (x[_key] < y[_key]);
        }
    })();

    function compareDate(x, y) {
        let xTime = new Date(x).getTime();
        let yTime = new Date(y).getTime();
        return xTime - yTime;
    }

    function separateArtists(tracks, space, isRandom = false) {
        if (isRandom) {
            shuffle(tracks);
        }
        let items = Filter.separateArtistsDuplicated(tracks);
        let original = items.original;
        let duplicate = items.duplicate;
        duplicate.forEach((item) => tryInsert(item));
        Combiner.replace(tracks, original);

        function tryInsert(item) {
            for (let i = 0; i <= original.length; i++) {
                let startIndex = i - space > 0 ? i - space : 0;
                let endIndex = i + space < original.length ? i + space : original.length;
                if (isCorrectRow(item, startIndex, endIndex)) {
                    original.splice(i, 0, item);
                    break;
                }
            }
        }

        function isCorrectRow(item, startIndex, endIndex) {
            for (let i = startIndex; i <= endIndex; i++) {
                if (original[i] && original[i].id === item.id) {
                    return false;
                }
            }
            return true;
        }
    }

    return {
        shuffle: shuffle,
        reverse: reverse,
        sort: sort,
        separateArtists: separateArtists,
        compareDate: compareDate,
    };
})();

const getCachedTracks = (function () {
    let cachedTracks = { meta: [], artists: {}, albums: {}, features: {} };
    let uncachedTracks;
    let _tracks, _args;

    return function getCache(tracks, args) {
        cache(tracks, args);
        return cachedTracks;
    };

    function cache(tracks, args) {
        _tracks = tracks;
        _args = args;
        uncachedTracks = { meta: [], artists: [], albums: [], features: [] };
        findIdsOfUncachedObj();
        cacheToFullObj();
    }

    function findIdsOfUncachedObj() {
        _tracks.forEach((track) => {
            if (_args.meta && !cachedTracks.meta[track.id] && isTrackSimplified(track)) {
                uncachedTracks.meta.push(track.id);
            }
            if (_args.artist && !cachedTracks.artists[track.artists[0].id] && isArtistSimplified(track)) {
                uncachedTracks.artists.push(track.artists[0].id);
            }
            if (_args.album && !cachedTracks.albums[track.album.id] && isAlbumSimplified(track)) {
                uncachedTracks.albums.push(track.album.id);
            }
            if (_args.features && !cachedTracks.features[track.id]) {
                uncachedTracks.features.push(track.id);
            }
        });
    }

    function cacheToFullObj() {
        if (uncachedTracks.meta.length > 0) {
            let fullTracks = Request.getFullObjByIds('tracks', uncachedTracks.meta, 50);
            fullTracks.forEach((track) => (cachedTracks.meta[track.id] = track));
        }
        if (uncachedTracks.artists.length > 0) {
            let fullArtists = Request.getFullObjByIds('artists', uncachedTracks.artists, 50);
            fullArtists.forEach((artist) => (cachedTracks.artists[artist.id] = artist));
        }
        if (uncachedTracks.albums.length > 0) {
            let fullAlbums = Request.getFullObjByIds('albums', uncachedTracks.albums, 20);
            fullAlbums.forEach((album) => (cachedTracks.albums[album.id] = album));
        }
        if (uncachedTracks.features.length > 0) {
            // limit = 100, но UrlFetchApp.fetch выдает ошибку о превышении длины URL
            // При limit 85, длина URL для этого запроса 2001 символ
            let features = Request.getFullObjByIds('audio-features', uncachedTracks.features, 85);
            features.forEach((item) => {
                if (item != null) {
                    cachedTracks.features[item.id] = item;
                }
            });
        }
    }

    // В объектах Track, Album, Artist Simplified нет ключа popularity
    function isTrackSimplified(track) {
        return !track.popularity;
    }

    function isArtistSimplified(track) {
        return !track.artists[0].popularity;
    }

    function isAlbumSimplified(track) {
        return !track.album.popularity;
    }
})();

const Lastfm = (function () {
    const LASTFM_API_BASE_URL = 'http://ws.audioscrobbler.com/2.0/?';
    const LASTFM_STATION = 'https://www.last.fm/player/station/user';

    function removeRecentTracks(sourceArray, lastfmUser, limit = 600) {
        let removedArray = getLastfmRecentTracks(lastfmUser, limit);
        let removedNames = removedArray.map((item) => getLastfmTrackKey(item));
        let filteredTracks = sourceArray.filter((item) => !removedNames.includes(getSpotifyTrackKey(item)));
        Combiner.replace(sourceArray, filteredTracks);
    }

    function removeRecentArtists(sourceArray, lastfmUser, limit = 600) {
        let removedArray = getRecentTracks(lastfmUser, limit);
        let removedNames = removedArray.map((item) => item.artist['#text']);
        let filteredTracks = sourceArray.filter((item) => !removedNames.includes(item.artists[0].name));
        Combiner.replace(sourceArray, filteredTracks);
    }

    function getLastfmTrackKey(item) {
        let artist = item.artist.name ? item.artist.name : item.artist['#text'];
        return Utilities.formatString('%s %s', item.name, artist).toLowerCase();
    }

    function getSpotifyTrackKey(item) {
        return Utilities.formatString('%s %s', item.name, item.artists[0].name).toLowerCase();
    }

    function getLastfmTrackname(item) {
        let artist;
        if (item.artist) {
            artist = item.artist.name ? item.artist.name : item.artist['#text'];
        } else if (item.artists) {
            artist = item.artists[0].name;
        }
        return Utilities.formatString('%s %s', artist, item.name).toLowerCase();
    }

    function getLastfmRecentTracks(user, limit) {
        let queryObj = {
            method: 'user.getrecenttracks',
            user: user,
            limit: 200,
        };
        return getAllPagesTracks(queryObj, limit);
    }

    function getRecentTracks(user, limit) {
        let tracks = getLastfmRecentTracks(user, limit);
        if (isNowPlayling(tracks[0])) {
            tracks.splice(0, 1);
        }
        return multisearchTracks(tracks);
    }

    function getLovedTracks(user, limit) {
        let queryObj = {
            method: 'user.getlovedtracks',
            user: user,
            limit: 50,
        };
        return multisearchTracks(getAllPagesTracks(queryObj, limit));
    }

    function getTopTracks(params) {
        let queryObj = {
            method: 'user.gettoptracks',
            user: params.user,
            period: params.period ? params.period : 'overall',
            limit: 50,
        };
        return multisearchTracks(getAllPagesTracks(queryObj, params.limit));
    }

    function getMixStation(user, countRequest) {
        return getStationPlaylist(user, 'mix', countRequest);
    }

    function getLibraryStation(user, countRequest) {
        return getStationPlaylist(user, 'library', countRequest);
    }

    function getRecomStation(user, countRequest) {
        return getStationPlaylist(user, 'recommended', countRequest);
    }

    function getNeighboursStation(user, countRequest) {
        return getStationPlaylist(user, 'neighbours', countRequest);
    }

    function getStationPlaylist(user, type, countRequest) {
        let stationTracks = getStationTracks(user, type, countRequest);
        let tracks = multisearchTracks(stationTracks);
        Filter.dedupTracks(tracks);
        return tracks;
    }

    function getStationTracks(user, type, countRequest) {
        let url = Utilities.formatString('%s/%s/%s', LASTFM_STATION, user, type);
        let stationTracks = [];
        for (let i = 0; i < countRequest; i++) {
            let response = Request.parseJSON(requestGet(url));
            if (response.playlist) {
                Combiner.push(stationTracks, response.playlist);
            }
        }
        return stationTracks;
    }

    function getAllPagesTracks(queryObj, limit) {
        if (!queryObj.page) {
            queryObj.page = 1;
        }
        let methodKey = queryObj.method.split('.get')[1];
        let requestCount = Math.ceil(limit / queryObj.limit);
        let response = [];
        for (let i = 0; i < requestCount; i++) {
            Combiner.push(response, getPageTracks(queryObj)[methodKey]['track']);
            queryObj.page++;
        }
        return Selector.sliceFirst(response, limit);
    }

    function getPageTracks(queryObj) {
        queryObj.api_key = LASTFM_API_KEY;
        queryObj.format = 'json';
        let url = LASTFM_API_BASE_URL + Request.parseQuery(queryObj);
        return Request.parseJSON(requestGet(url));
    }

    function multisearchTracks(items) {
        let tracks = [];
        for (let i = 0; i < items.length; i++) {
            let trackname = getLastfmTrackname(items[i]);
            let track = Source.searchTrack(trackname);
            if (track.id) {
                if (items[i].date) {
                    track.played_at = items[i].date['#text'];
                }
                tracks.push(track);
            }
        }
        return tracks;
    }

    function isNowPlayling(track) {
        return track['@attr'] && track['@attr'].nowplaying === 'true';
    }

    function requestGet(url) {
        let params = { method: 'get', muteHttpExceptions: true };
        let response = UrlFetchApp.fetch(url, params);
        if (response.getResponseCode() >= 300) {
            console.error('Ошибка', response.getResponseCode(), response);
            Utilities.sleep(2000);
            console.info('Попытка повторной отправки');
            return UrlFetchApp.fetch(url, params);
        }
        return response;
    }

    return {
        removeRecentTracks: removeRecentTracks,
        removeRecentArtists: removeRecentArtists,
        getLovedTracks: getLovedTracks,
        getRecentTracks: getRecentTracks,
        getTopTracks: getTopTracks,
        getMixStation: getMixStation,
        getLibraryStation: getLibraryStation,
        getRecomStation: getRecomStation,
        getNeighboursStation: getNeighboursStation,
    };
})();

const Yandex = (function () {
    const YANDEX_PLAYLIST = 'https://music.mts.ru/handlers/playlist.jsx?';
    const YANDEX_LIBRARY = 'https://music.mts.ru/handlers/library.jsx?';

    function getArtists(owner, limit, offset) {
        let responseLibrary = getLibrary({
            owner: owner,
            filter: 'artists',
        });
        let artistItems = slice(responseLibrary.artists, limit, offset);
        return multisearchArtists(artistItems);
    }

    function getLibrary(queryObj) {
        let url = YANDEX_LIBRARY + Request.parseQuery(queryObj);
        return Request.parseJSON(UrlFetchApp.fetch(url));
    }

    function multisearchArtists(items) {
        let artists = [];
        for (let i = 0; i < items.length; i++) {
            let artistname = getYandexArtistname(items[i]);
            let artist = Source.searchArtist(artistname);
            if (artist.id) {
                artists.push(artist);
            }
        }
        return artists;
    }

    function getTracks(owner, kinds, limit, offset) {
        let responsePlaylist = getPlaylist({
            owner: owner,
            kinds: kinds,
            light: false,
        });
        let trackItems = slice(responsePlaylist.playlist.tracks, limit, offset);
        return multisearchTracks(trackItems);
    }

    function getPlaylist(queryObj) {
        let url = YANDEX_PLAYLIST + Request.parseQuery(queryObj);
        return Request.parseJSON(UrlFetchApp.fetch(url));
    }

    function multisearchTracks(items) {
        let tracks = [];
        for (let i = 0; i < items.length; i++) {
            let trackname = getYandexTrackname(items[i]);
            let track = Source.searchTrack(trackname);
            if (track.id) {
                tracks.push(track);
            }
        }
        return tracks;
    }

    function getYandexTrackname(item) {
        if (!item.title) {
            return '';
        }
        if (item.artists.length == 0 || !item.artists[0].name) {
            return item.title.toLowerCase();
        }
        return Utilities.formatString('%s %s', item.artists[0].name, item.title).toLowerCase();
    }

    function getYandexArtistname(item) {
        if (!item.name) {
            return '';
        }
        return item.name.toLowerCase();
    }

    function slice(array, limit, offset) {
        if (limit) {
            offset = offset ? offset : 0;
            return array.slice(offset, offset + limit);
        }
        return array;
    }

    return {
        getTracks: getTracks,
        getArtists: getArtists,
    };
})();

const Library = (function () {
    function followArtists(artists) {
        modifyFollowArtists(Request.putIds, artists);
    }

    function unfollowArtists(artists) {
        modifyFollowArtists(Request.deleteIds, artists);
    }

    function modifyFollowArtists(method, artists) {
        let url = Utilities.formatString('%s/%s', API_BASE_URL, 'me/following?type=artist');
        let ids = artists.map((artist) => artist.id);
        method(url, ids, 50);
    }

    function saveFavoriteTracks(tracks) {
        modifyFavoriteTracks(Request.putIds, tracks);
    }

    function deleteFavoriteTracks(tracks) {
        modifyFavoriteTracks(Request.deleteIds, tracks);
    }

    function modifyFavoriteTracks(method, tracks) {
        let url = Utilities.formatString('%s/%s', API_BASE_URL, 'me/tracks');
        let ids = tracks.map((track) => track.id);
        method(url, ids, 50);
    }

    return {
        followArtists: followArtists,
        unfollowArtists: unfollowArtists,
        saveFavoriteTracks: saveFavoriteTracks,
        deleteFavoriteTracks: deleteFavoriteTracks,
    };
})();

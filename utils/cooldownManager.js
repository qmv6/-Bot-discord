const fs   = require('fs');
const path = require('path');
const { logError } = require('./logger');
const ImageGenerator = require('./imageGenerator');

const cacheDir  = path.join(__dirname, '..', 'cache');
const CACHE_LIMIT = 300;
const cacheTrackerPath = path.join(cacheDir, 'cache_tracker.json');

if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

let cacheTracker = {};

function loadCacheTracker() {
    try {
        if (fs.existsSync(cacheTrackerPath)) {
            cacheTracker = JSON.parse(fs.readFileSync(cacheTrackerPath, 'utf8'));
        }
    } catch { cacheTracker = {}; }
}

function saveCacheTracker() {
    try { fs.writeFileSync(cacheTrackerPath, JSON.stringify(cacheTracker, null, 2)); }
    catch { console.error('Failed to save cache tracker'); }
}

function updateCacheAccess(imagePath) {
    cacheTracker[imagePath] = Date.now();
    saveCacheTracker();
}

function cleanupCache() {
    try {
        const images = Object.entries(cacheTracker);
        if (images.length <= CACHE_LIMIT) return;
        const sorted   = images.sort((a, b) => a[1] - b[1]);
        const toDelete  = sorted.slice(0, images.length - CACHE_LIMIT);
        for (const [imagePath] of toDelete) {
            const fullPath = path.join(cacheDir, imagePath);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
            delete cacheTracker[imagePath];
        }
        saveCacheTracker();
    } catch (error) { logError(error, 'Cache Cleanup'); }
}

async function getCachedImage(userId, identityNum, identityData) {
    try {
        const userCacheDir = path.join(cacheDir, `user_${userId}`);
        if (!fs.existsSync(userCacheDir)) fs.mkdirSync(userCacheDir, { recursive: true });

        const cachePath    = path.join(userCacheDir, `identity_${identityNum}.png`);
        const relativePath = `user_${userId}/identity_${identityNum}.png`;

        if (fs.existsSync(cachePath)) {
            updateCacheAccess(relativePath);
            return cachePath;
        }

        const img = await ImageGenerator.createIdentityImage(identityData);
        fs.copyFileSync(img, cachePath);
        if (fs.existsSync(img)) fs.unlinkSync(img);

        updateCacheAccess(relativePath);
        cleanupCache();
        return cachePath;
    } catch (error) {
        logError(error, 'Get Cached Image');
        return null;
    }
}

function deleteCachedImage(userId, identityNum) {
    try {
        const cachePath    = path.join(cacheDir, `user_${userId}`, `identity_${identityNum}.png`);
        const relativePath = `user_${userId}/identity_${identityNum}.png`;
        if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
            delete cacheTracker[relativePath];
            saveCacheTracker();
        }
    } catch (error) { logError(error, 'Delete Cached Image'); }
}

function deleteAllUserCache(userId) {
    try {
        const userCacheDir = path.join(cacheDir, `user_${userId}`);
        if (fs.existsSync(userCacheDir)) {
            fs.readdirSync(userCacheDir).forEach(file => {
                const relativePath = `user_${userId}/${file}`;
                fs.unlinkSync(path.join(userCacheDir, file));
                delete cacheTracker[relativePath];
            });
            fs.rmdirSync(userCacheDir);
            saveCacheTracker();
        }
    } catch (error) { logError(error, 'Delete All User Cache'); }
}

function cleanupTempFolder() {
    try {
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) return;
        fs.readdirSync(tempDir).forEach(file => {
            try { fs.unlinkSync(path.join(tempDir, file)); } catch {}
        });
    } catch (error) { logError(error, 'Cleanup Temp Folder'); }
}

loadCacheTracker();

module.exports = {
    cacheTracker,
    getCachedImage,
    deleteCachedImage,
    deleteAllUserCache,
    cleanupTempFolder,
    updateCacheAccess,
    cleanupCache,
    saveCacheTracker,
    cacheDir
};

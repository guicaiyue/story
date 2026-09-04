(function (window) {
    'use strict';

    const pending = [];
    let retryTimer = null;
    let retryCount = 0;
    const MAX_RETRIES = 40;

    function cleanData(data) {
        const result = {};
        Object.keys(data || {}).forEach(key => {
            const value = data[key];
            if (value === undefined || value === null || value === '') return;
            result[key] = typeof value === 'string' ? value.slice(0, 500) : value;
        });
        return result;
    }

    function sendNow(item) {
        if (!window.umami || typeof window.umami.track !== 'function') return false;
        try {
            window.umami.track(item.name, item.data);
            return true;
        } catch (error) {
            console.warn('Umami event tracking failed:', error);
            return false;
        }
    }

    function flush() {
        while (pending.length && sendNow(pending[0])) pending.shift();
        retryCount += 1;
        if (!pending.length || retryCount >= MAX_RETRIES) {
            if (retryTimer) window.clearInterval(retryTimer);
            retryTimer = null;
        }
    }

    function track(name, data) {
        const item = { name, data: cleanData(data) };
        if (sendNow(item)) return true;
        pending.push(item);
        if (!retryTimer) {
            retryCount = 0;
            retryTimer = window.setInterval(flush, 500);
        }
        return false;
    }

    function storyData(story, source, extra) {
        return Object.assign({
            story_id: String(story && story.id !== undefined ? story.id : ''),
            title: story && story.title,
            category: story && story.category_name,
            source: source || 'unknown'
        }, extra || {});
    }

    function trackStory(name, story, source, extra) {
        if (!story || story.id === undefined || story.id === null) return false;
        return track(name, storyData(story, source, extra));
    }

    window.StoryAnalytics = {
        track,
        trackStory,
        storyData,
        flush,
        _pending: pending
    };
})(window);

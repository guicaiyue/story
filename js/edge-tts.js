/* ============================================================
 * edge-tts.js — Edge-TTS 前端直连引擎（story 项目）
 * 浏览器直连微软 Edge-TTS 合成 mp3，无需后台代理
 * 核心要点见 memory/edge_tts_sop.md
 * ============================================================ */
(function () {
    'use strict';

    // ---------- 中英文语音列表 ----------
    const VOICES = [
        { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（中文·女·温暖）', lang: 'zh-CN' },
        { id: 'zh-CN-YunxiNeural', label: '云希（中文·男）', lang: 'zh-CN' },
        { id: 'zh-CN-YunjianNeural', label: '云健（中文·男）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyiNeural', label: '晓伊（中文·女）', lang: 'zh-CN' },
        { id: 'zh-CN-liaoning-XiaobeiNeural', label: '小北（中文·东北女声）', lang: 'zh-CN' },
        { id: 'en-US-AriaNeural', label: 'Aria（英文·女）', lang: 'en-US' },
        { id: 'en-US-JennyNeural', label: 'Jenny（英文·女）', lang: 'en-US' },
        { id: 'en-US-GuyNeural', label: 'Guy（英文·男）', lang: 'en-US' },
        { id: 'en-US-ChristopherNeural', label: 'Christopher（英文·男）', lang: 'en-US' },
        { id: 'en-GB-SoniaNeural', label: 'Sonia（英音·女）', lang: 'en-GB' }
    ];

    // ---------- 语言风格 ----------
    const STYLES = [
        { id: 'affectionate', label: '亲切温暖' },
        { id: 'calm', label: '平静舒缓' },
        { id: 'cheerful', label: '愉快欢乐' },
        { id: 'gentle', label: '温和柔美' },
        { id: 'lyrical', label: '抒情诗意' }
    ];

    const DEFAULT_SETTINGS = {
        voice: 'zh-CN-XiaoxiaoNeural',
        style: 'affectionate',
        rate: 1.0,
        volume: 100
    };

    const STORAGE_KEY = 'story_tts_settings';

    function loadSettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
        } catch (e) { /* ignore */ }
        return Object.assign({}, DEFAULT_SETTINGS);
    }
    function saveSettings(s) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    }

    // ---------- 签名工具 ----------
    function base64ToBytes(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }
    function bytesToBase64(bytes) {
        let s = '';
        bytes.forEach(b => s += String.fromCharCode(b));
        return btoa(s);
    }
    async function hmacSha256(keyBytes, data) {
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign']);
        return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data)));
    }
    function dateFormat() {
        const formattedDate = (new Date()).toUTCString().replace(/GMT/, '').trim() + ' GMT';
        return formattedDate.toLowerCase();
    }
    function uuidNoDash() {
        return crypto.randomUUID().replace(/-/g, '');
    }
    // 签名：key=base64解码64字节；待签=MSTranslatorAndroidApp+encodeURIComponent(url去协议)+小写日期+uuid
    async function sign(urlStr) {
        const url = urlStr.split('://')[1];
        const encodedUrl = encodeURIComponent(url);
        const uuidStr = uuidNoDash();
        const formattedDate = dateFormat();
        const bytesToSign = ('MSTranslatorAndroidApp' + encodedUrl + formattedDate + uuidStr).toLowerCase();
        const decode = base64ToBytes('oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==');
        const signData = await hmacSha256(decode, bytesToSign);
        const signBase64 = bytesToBase64(signData);
        return 'MSTranslatorAndroidApp::' + signBase64 + '::' + formattedDate + '::' + uuidStr;
    }

    // ---------- Token 获取（带缓存）----------
    const ENDPOINT_URL = 'https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0';
    let tokenCache = { token: null, expiredAt: 0 };

    async function getToken() {
        const now = Date.now() / 1000;
        if (tokenCache.token && now < tokenCache.expiredAt - 60) return tokenCache.token;
        const clientId = uuidNoDash();
        const resp = await fetch(ENDPOINT_URL, {
            method: 'POST',
            referrerPolicy: 'no-referrer', // 关键：微软校验 Referer，任何非空 Referer→401
            headers: {
                'Accept-Language': 'zh-Hans',
                'X-ClientVersion': '4.0.530a 5fe1dc6c',
                'X-UserId': '0f04d16a175c411e',
                'X-HomeGeographicRegion': 'zh-Hans-CN',
                'X-ClientTraceId': clientId,
                'X-MT-Signature': await sign(ENDPOINT_URL),
                'Content-Type': 'application/json; charset=utf-8'
            },
            body: ''
        });
        if (!resp.ok) throw new Error('Edge-TTS token 获取失败: HTTP ' + resp.status);
        const data = await resp.json();
        tokenCache = { token: data.t, region: data.r, expiredAt: Date.now() / 1000 + 540 }; // 9分钟过期
        return data.t;
    }

    // ---------- XML 转义 ----------
    function escapeXmlText(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // ---------- 段落指令解析 ----------
    // 段落级前缀指令： [voice=zh-CN-YunxiNeural] [style=cheerful] [rate=1.2] [volume=90] [pitch=1.1] 文本
    // 行内停顿指令： [pause:500] → <break time="500ms"/>
    const DIR_RE = /^\s*\[([a-zA-Z]+)[=:]([^\]]+)\]\s*/;
    function parseParagraphDirectives(paragraph) {
        const dirs = {};
        let rest = paragraph;
        let m;
        while ((m = rest.match(DIR_RE))) {
            dirs[m[1].toLowerCase()] = m[2].trim();
            rest = rest.slice(m[0].length);
        }
        return { dirs, text: rest };
    }
    function applyInlineDirectives(text) {
        // [pause:500] / [pause=500] → <break time="500ms"/>
        return text.replace(/\[pause[=:]\s*(\d+)\s*(?:ms)?\]/gi, (_, ms) => `<break time="${ms}ms" />`);
    }

    // ---------- SSML 构建 ----------
    function buildSsml(text, opts) {
        const escaped = applyInlineDirectives(escapeXmlText(text));
        const lang = (opts.voice || '').startsWith('en') ? 'en-US' : 'zh-CN';
        const styleTag = opts.style ? `<mstts:express-as style="${opts.style}" styledegree="2.0" role="default">` : '';
        const styleEnd = opts.style ? '</mstts:express-as>' : '';
        return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="${lang}">
    <voice name="${opts.voice}">
        ${styleTag}
            <prosody rate="${opts.rate}" pitch="${opts.pitch || '0Hz'}" volume="${opts.volume}">${escaped}</prosody>
        ${styleEnd}
    </voice>
</speak>`;
    }

    // ---------- 单段合成 ----------
    async function synthSegment(text, opts) {
        await getToken(); // 确保 tokenCache 已填充
        const tokenData = tokenCache;
        const ttsUrl = `https://${tokenData.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
        const ssml = buildSsml(text, opts);
        const doPost = (ssmlBody) => fetch(ttsUrl, {
            method: 'POST',
            referrerPolicy: 'no-referrer',
            headers: {
                'Authorization': `Bearer ${tokenData.token}`,
                'Content-Type': 'application/ssml+xml',
                'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3'
            },
            body: ssmlBody
        });
        let resp = await doPost(ssml);
        // 若 style 不被该 voice 支持（400），去掉 style 重试
        if (resp.status === 400 && opts.style) {
            const noStyle = Object.assign({}, opts, { style: '' });
            resp = await doPost(buildSsml(text, noStyle));
        }
        if (!resp.ok) throw new Error('Edge-TTS 合成失败: HTTP ' + resp.status);
        return await resp.blob();
    }

    // ---------- 播放引擎 ----------
    let state = {
        settings: loadSettings(),
        playing: false,
        paused: false,
        stopRequested: false,
        segments: [],
        currentIndex: 0,
        currentAudio: null,
        currentBlobUrl: null,
        prefetchAudio: null,
        prefetchBlobUrl: null,
        onStateChange: null
    };

    function setButtonState(s) {
        if (typeof window.updateTTSButton === 'function') window.updateTTSButton(s);
        if (state.onStateChange) state.onStateChange(s);
    }

    function getSegments(text) {
        return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    }

    // 合成第 idx 段（支持段落级指令覆盖设置）
    async function synthForIndex(idx) {
        const para = state.segments[idx];
        const { dirs, text } = parseParagraphDirectives(para);
        if (!text.trim()) return null;
        const opts = Object.assign({}, state.settings, {
            voice: dirs.voice || state.settings.voice,
            style: dirs.style || state.settings.style,
            rate: parseFloat(dirs.rate) || state.settings.rate,
            volume: parseInt(dirs.volume, 10) || state.settings.volume,
            pitch: dirs.pitch || '0Hz'
        });
        return await synthSegment(text, opts);
    }

    async function playSegment(idx) {
        if (state.stopRequested || idx >= state.segments.length) {
            finishPlayback();
            return;
        }
        state.currentIndex = idx;
        let blob;
        try {
            if (state.prefetchAudio && state.prefetchBlobUrl) {
                // 用预取的下一段
                state.currentAudio = state.prefetchAudio;
                state.currentBlobUrl = state.prefetchBlobUrl;
                state.prefetchAudio = null;
                state.prefetchBlobUrl = null;
            } else {
                blob = await synthForIndex(idx);
                if (!blob) { playSegment(idx + 1); return; }
                state.currentBlobUrl = URL.createObjectURL(blob);
                state.currentAudio = new Audio(state.currentBlobUrl);
            }
            // 预取下一段
            if (idx + 1 < state.segments.length && !state.stopRequested) {
                synthForIndex(idx + 1).then(b => {
                    if (b && !state.stopRequested) {
                        state.prefetchBlobUrl = URL.createObjectURL(b);
                        state.prefetchAudio = new Audio(state.prefetchBlobUrl);
                    }
                }).catch(() => { /* 预取失败忽略，播放时再取 */ });
            }
            state.currentAudio.onended = () => {
                playSegment(idx + 1);
            };
            state.currentAudio.onerror = () => {
                showToast && showToast('语音播放出错，跳过本段', 'error');
                playSegment(idx + 1);
            };
            await state.currentAudio.play();
            state.playing = true;
            state.paused = false;
            setButtonState('playing');
        } catch (e) {
            console.error('Edge-TTS 播放失败:', e);
            if (!state.stopRequested) {
                showToast && showToast('语音合成失败：' + e.message, 'error');
            }
            finishPlayback();
        }
    }

    function finishPlayback() {
        cleanupAudio();
        state.playing = false;
        state.paused = false;
        setButtonState('stopped');
    }

    function cleanupAudio() {
        if (state.currentAudio) {
            try { state.currentAudio.pause(); } catch (e) { /* ignore */ }
            state.currentAudio = null;
        }
        if (state.currentBlobUrl) { URL.revokeObjectURL(state.currentBlobUrl); state.currentBlobUrl = null; }
        if (state.prefetchAudio) { try { state.prefetchAudio.pause(); } catch (e) { /* ignore */ } state.prefetchAudio = null; }
        if (state.prefetchBlobUrl) { URL.revokeObjectURL(state.prefetchBlobUrl); state.prefetchBlobUrl = null; }
    }

    // ---------- 对外 API ----------
    const EdgeTTS = {
        start(text) {
            state.stopRequested = false;
            state.paused = false;
            state.segments = getSegments(text || '');
            if (state.segments.length === 0) {
                showToast && showToast('没有可朗读的内容', 'warning');
                return;
            }
            cleanupAudio();
            state.currentIndex = 0;
            playSegment(0);
        },
        pause() {
            if (state.currentAudio && state.playing && !state.paused) {
                state.currentAudio.pause();
                state.paused = true;
                state.playing = false;
                setButtonState('paused');
            }
        },
        resume() {
            if (state.currentAudio && state.paused) {
                state.currentAudio.play().then(() => {
                    state.paused = false;
                    state.playing = true;
                    setButtonState('playing');
                }).catch(() => { /* ignore */ });
            }
        },
        stop() {
            state.stopRequested = true;
            cleanupAudio();
            state.playing = false;
            state.paused = false;
            state.segments = [];
            setButtonState('stopped');
        },
        isPlaying() { return state.playing && !state.paused; },
        isPaused() { return state.paused; },
        getSettings() { return Object.assign({}, state.settings); },
        setSettings(s) { state.settings = Object.assign({}, state.settings, s); saveSettings(state.settings); },
        // 供测试/调试
        _state: state,
        _synthSegment: synthSegment,
        _parseParagraphDirectives: parseParagraphDirectives
    };
    window.EdgeTTS = EdgeTTS;

    // ---------- 设置弹窗 ----------
    function buildModalHtml() {
        const voiceOptions = VOICES.map(v => `<option value="${v.id}">${v.label}</option>`).join('');
        const styleOptions = STYLES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
        return `<div class="edge-tts-modal-overlay" id="edgeTtsModalOverlay" style="display:none">
            <div class="edge-tts-modal">
                <div class="edge-tts-modal-header">
                    <h3>语音设置</h3>
                    <button class="edge-tts-modal-close" id="edgeTtsModalClose"><i class="fas fa-times"></i></button>
                </div>
                <div class="edge-tts-modal-body">
                    <div class="edge-tts-field">
                        <label>朗读人物</label>
                        <select id="edgeTtsVoiceSelect">${voiceOptions}</select>
                    </div>
                    <div class="edge-tts-field">
                        <label>语言风格</label>
                        <select id="edgeTtsStyleSelect">${styleOptions}</select>
                    </div>
                    <div class="edge-tts-field">
                        <label>语速：<span class="edge-tts-value" id="edgeTtsRateValue">1.0</span></label>
                        <input type="range" id="edgeTtsRateRange" min="0.5" max="2.0" step="0.05" value="1.0">
                    </div>
                    <div class="edge-tts-field">
                        <label>音量：<span class="edge-tts-value" id="edgeTtsVolumeValue">100</span></label>
                        <input type="range" id="edgeTtsVolumeRange" min="0" max="100" step="1" value="100">
                    </div>
                    <div class="edge-tts-tip">提示：文章中可带指令 <code>[style=cheerful]</code> <code>[rate=1.2]</code> <code>[pause:500]</code> 等，本段生效。</div>
                </div>
            </div>
        </div>`;
    }

    function openSettings() {
        let overlay = document.getElementById('edgeTtsModalOverlay');
        if (!overlay) {
            const div = document.createElement('div');
            div.innerHTML = buildModalHtml();
            document.body.appendChild(div.firstElementChild);
            overlay = document.getElementById('edgeTtsModalOverlay');
            bindModalEvents();
        }
        const s = state.settings;
        document.getElementById('edgeTtsVoiceSelect').value = s.voice;
        document.getElementById('edgeTtsStyleSelect').value = s.style;
        document.getElementById('edgeTtsRateRange').value = s.rate;
        document.getElementById('edgeTtsRateValue').textContent = s.rate;
        document.getElementById('edgeTtsVolumeRange').value = s.volume;
        document.getElementById('edgeTtsVolumeValue').textContent = s.volume;
        overlay.style.display = 'flex';
    }

    function closeSettings() {
        const overlay = document.getElementById('edgeTtsModalOverlay');
        if (overlay) overlay.style.display = 'none';
    }

    function bindModalEvents() {
        const overlay = document.getElementById('edgeTtsModalOverlay');
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeSettings();
        });
        document.getElementById('edgeTtsModalClose').addEventListener('click', closeSettings);
        const voiceSel = document.getElementById('edgeTtsVoiceSelect');
        const styleSel = document.getElementById('edgeTtsStyleSelect');
        const rateRange = document.getElementById('edgeTtsRateRange');
        const rateValue = document.getElementById('edgeTtsRateValue');
        const volRange = document.getElementById('edgeTtsVolumeRange');
        const volValue = document.getElementById('edgeTtsVolumeValue');
        voiceSel.addEventListener('change', () => { EdgeTTS.setSettings({ voice: voiceSel.value }); });
        styleSel.addEventListener('change', () => { EdgeTTS.setSettings({ style: styleSel.value }); });
        rateRange.addEventListener('input', () => {
            rateValue.textContent = parseFloat(rateRange.value).toFixed(2);
            EdgeTTS.setSettings({ rate: parseFloat(rateRange.value) });
        });
        volRange.addEventListener('input', () => {
            volValue.textContent = volRange.value;
            EdgeTTS.setSettings({ volume: parseInt(volRange.value, 10) });
        });
    }

    // 设置按钮：给 tts-controls 插入齿轮按钮
    function ensureSettingsButton() {
        const controls = document.querySelector('.tts-controls');
        if (!controls || document.getElementById('ttsSettingsButton')) return;
        const btn = document.createElement('button');
        btn.id = 'ttsSettingsButton';
        btn.className = 'tts-button tts-settings-button';
        btn.title = '语音设置';
        btn.innerHTML = '<i class="fas fa-cog" style="font-size:18px;color:inherit"></i>';
        btn.addEventListener('click', openSettings);
        controls.appendChild(btn);
    }

    // DOMContentLoaded 后注入设置按钮
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureSettingsButton);
    } else {
        ensureSettingsButton();
    }
    // 路由切换（SPA）后 article-view 可能重新渲染，需重新确保按钮
    const origShowArticle = window.showArticle;
    if (typeof origShowArticle === 'function') {
        window.showArticle = function () {
            const ret = origShowArticle.apply(this, arguments);
            setTimeout(ensureSettingsButton, 50);
            return ret;
        };
    } else {
        setInterval(() => { if (document.querySelector('.article-view') && document.querySelector('.article-view').style.display !== 'none') ensureSettingsButton(); }, 2000);
    }
})();

/* ============================================================
 * edge-tts.js — Edge-TTS 前端直连引擎（story 项目）
 * 浏览器直连微软 Edge-TTS 合成 mp3，无需后台代理
 * 核心要点见 memory/edge_tts_sop.md
 * ============================================================ */
(function () {
    'use strict';

    // ---------- 中英文语音列表（全量） ----------
    // 微软 Edge-TTS 支持的中文/英文声音全集（2026-08）
    const ZH_VOICES = [
        { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女·温暖）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女）', lang: 'zh-CN' },
        { id: 'zh-CN-YunjianNeural', label: '云健（男）', lang: 'zh-CN' },
        { id: 'zh-CN-YunxiNeural', label: '云希（男）', lang: 'zh-CN' },
        { id: 'zh-CN-YunxiaNeural', label: '云夏（男·少年）', lang: 'zh-CN' },
        { id: 'zh-CN-YunyangNeural', label: '云扬（男）', lang: 'zh-CN' },
        { id: 'zh-CN-liaoning-XiaobeiNeural', label: '小北（女·东北话）', lang: 'zh-CN' },
        { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮（女·陕西话）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaochenNeural', label: '晓辰（女·儿童）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaohanNeural', label: '晓涵（女）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaomengNeural', label: '晓梦（女）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaomoNeural', label: '晓墨（女）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoqiuNeural', label: '晓秋（女）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoruiNeural', label: '晓睿（女）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoshuangNeural', label: '晓双（女·儿童）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoxuanNeural', label: '晓萱（女）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyanNeural', label: '晓颜（女）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyouNeural', label: '晓悠（女·儿童）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaozhenNeural', label: '晓甄（女）', lang: 'zh-CN' },
        { id: 'zh-CN-YunfengNeural', label: '云枫（男）', lang: 'zh-CN' },
        { id: 'zh-CN-YunhaoNeural', label: '云皓（男）', lang: 'zh-CN' },
        { id: 'zh-CN-YunjieNeural', label: '云杰（男）', lang: 'zh-CN' },
        { id: 'zh-CN-YunlongNeural', label: '云龙（男）', lang: 'zh-CN' },
        { id: 'zh-CN-YunzeNeural', label: '云泽（男）', lang: 'zh-CN' }
    ];
    const EN_VOICES = [
        { id: 'en-US-AriaNeural', label: 'Aria（女）', lang: 'en-US' },
        { id: 'en-US-AndrewNeural', label: 'Andrew（男）', lang: 'en-US' },
        { id: 'en-US-AvaNeural', label: 'Ava（女）', lang: 'en-US' },
        { id: 'en-US-BrianNeural', label: 'Brian（男）', lang: 'en-US' },
        { id: 'en-US-ChristopherNeural', label: 'Christopher（男）', lang: 'en-US' },
        { id: 'en-US-EmmaNeural', label: 'Emma（女）', lang: 'en-US' },
        { id: 'en-US-EricNeural', label: 'Eric（男）', lang: 'en-US' },
        { id: 'en-US-GuyNeural', label: 'Guy（男）', lang: 'en-US' },
        { id: 'en-US-JennyNeural', label: 'Jenny（女）', lang: 'en-US' },
        { id: 'en-US-MichelleNeural', label: 'Michelle（女）', lang: 'en-US' },
        { id: 'en-US-RogerNeural', label: 'Roger（男）', lang: 'en-US' },
        { id: 'en-US-SteffanNeural', label: 'Steffan（男）', lang: 'en-US' },
        { id: 'en-GB-LibbyNeural', label: 'Libby（英音·女）', lang: 'en-GB' },
        { id: 'en-GB-MaisieNeural', label: 'Maisie（英音·女）', lang: 'en-GB' },
        { id: 'en-GB-RyanNeural', label: 'Ryan（英音·男）', lang: 'en-GB' },
        { id: 'en-GB-SoniaNeural', label: 'Sonia（英音·女）', lang: 'en-GB' },
        { id: 'en-GB-ThomasNeural', label: 'Thomas（英音·男）', lang: 'en-GB' },
        { id: 'en-GB-AlfieNeural', label: 'Alfie（英音·男）', lang: 'en-GB' },
        { id: 'en-GB-BellaNeural', label: 'Bella（英音·女）', lang: 'en-GB' },
        { id: 'en-GB-ElliotNeural', label: 'Elliot（英音·男）', lang: 'en-GB' },
        { id: 'en-GB-EthanNeural', label: 'Ethan（英音·男）', lang: 'en-GB' },
        { id: 'en-GB-HollieNeural', label: 'Hollie（英音·女）', lang: 'en-GB' },
        { id: 'en-GB-NoahNeural', label: 'Noah（英音·男）', lang: 'en-GB' },
        { id: 'en-GB-OliverNeural', label: 'Oliver（英音·男）', lang: 'en-GB' },
        { id: 'en-GB-OliviaNeural', label: 'Olivia（英音·女）', lang: 'en-GB' }
    ];
    // 语言切换用：中文 / 英文
    const LANG_MAP = {
        'zh': { label: '中文', voices: ZH_VOICES, defaultVoice: 'zh-CN-XiaoxiaoNeural' },
        'en': { label: 'English', voices: EN_VOICES, defaultVoice: 'en-US-AriaNeural' }
    };
    const VOICES = ZH_VOICES.concat(EN_VOICES);

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
    // ---------- 纯 JS SHA-256 / HMAC-SHA256 降级 ----------
    // 非安全上下文（HTTP 非 localhost）无 crypto.subtle/randomUUID，Edge-TTS 签名仍可工作
    const K256 = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    function jsSha256Bytes(bytes) {
        const l = bytes.length, bitLen = l * 8;
        const padded = new Uint8Array((((l + 8) >> 6) + 1) << 6);
        padded.set(bytes); padded[l] = 0x80;
        const dv = new DataView(padded.buffer);
        dv.setUint32(padded.length - 4, bitLen >>> 0);
        const w = new Array(64);
        let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
        const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
        for (let i=0;i<padded.length;i+=64) {
            for (let t=0;t<16;t++) w[t]=dv.getUint32(i+t*4);
            for (let t=16;t<64;t++) {
                const s0=rotr(w[t-15],7)^rotr(w[t-15],18)^(w[t-15]>>>3);
                const s1=rotr(w[t-2],17)^rotr(w[t-2],19)^(w[t-2]>>>10);
                w[t]=(w[t-16]+s0+w[t-7]+s1)>>>0;
            }
            let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
            for (let t=0;t<64;t++) {
                const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
                const ch=(e&f)^(~e&g);
                const temp1=(h+S1+ch+K256[t]+w[t])>>>0;
                const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
                const maj=(a&b)^(a&c)^(b&c);
                const temp2=(S0+maj)>>>0;
                h=g; g=f; f=e; e=(d+temp1)>>>0; d=c; c=b; b=a; a=(temp1+temp2)>>>0;
            }
            h0=(h0+a)>>>0; h1=(h1+b)>>>0; h2=(h2+c)>>>0; h3=(h3+d)>>>0; h4=(h4+e)>>>0; h5=(h5+f)>>>0; h6=(h6+g)>>>0; h7=(h7+h)>>>0;
        }
        const out=new Uint8Array(32), od=new DataView(out.buffer);
        od.setUint32(0,h0); od.setUint32(4,h1); od.setUint32(8,h2); od.setUint32(12,h3);
        od.setUint32(16,h4); od.setUint32(20,h5); od.setUint32(24,h6); od.setUint32(28,h7);
        return out;
    }
    function jsHmacSha256(keyBytes, dataStr) {
        const block=64;
        let k=keyBytes;
        if (k.length>block) k=jsSha256Bytes(k);
        const dataBytes = new TextEncoder().encode(dataStr);
        const ipad=new Uint8Array(block), opad=new Uint8Array(block);
        for (let i=0;i<block;i++){ ipad[i]=(k[i]||0)^0x36; opad[i]=(k[i]||0)^0x5c; }
        const inner=new Uint8Array(block + dataBytes.length);
        inner.set(ipad); inner.set(dataBytes, block);
        const innerHash=jsSha256Bytes(inner);
        const outer=new Uint8Array(block+32);
        outer.set(opad); outer.set(innerHash, block);
        return jsSha256Bytes(outer);
    }

    async function hmacSha256(keyBytes, data) {
        // 优先 WebCrypto（HTTPS/安全上下文）；非安全上下文降级纯 JS
        if (crypto && crypto.subtle && typeof crypto.subtle.importKey === 'function') {
            try {
                const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign']);
                return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data)));
            } catch (e) { /* fall through */ }
        }
        return jsHmacSha256(keyBytes, data);
    }
    function dateFormat() {
        const formattedDate = (new Date()).toUTCString().replace(/GMT/, '').trim() + ' GMT';
        return formattedDate.toLowerCase();
    }
    function uuidNoDash() {
        // 非安全上下文（HTTP 非 localhost）下 crypto.randomUUID 不可用，降级手动生成 v4 UUID
        try {
            if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
        } catch (e) { /* ignore */ }
        return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
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
        // 语言前缀：zh-CN / en-US / en-GB（方言 zh-CN-liaoning-* 也能匹配 zh-CN）
        const langMatch = (opts.voice || '').match(/^([a-z]{2}-[A-Z]{2})/);
        const lang = langMatch ? langMatch[1] : 'zh-CN';
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
        starting: false,   // 朗读加载阶段（start 后、第一段真正播放前）——用于防重 + 按钮转圈
        stopRequested: false,
        segments: [],
        currentIndex: 0,
        currentAudio: null,
        currentBlobUrl: null,
        prefetchAudio: null,
        prefetchBlobUrl: null,
        readyQueue: [],   // 预合成队列：[{idx, audio, blobUrl}]（页面打开预初始化前1-2段 + 播放中逐步预取）
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
        // 当前朗读段落文字变绿（醒目）
        highlightParagraph(idx);
        let blob;
        try {
            // 优先使用预合成队列中的音频（页面打开预初始化 + 播放中逐步预取）
            const readyIdx = state.readyQueue.findIndex(q => q.idx === idx);
            if (readyIdx >= 0) {
                state.currentAudio = state.readyQueue[readyIdx].audio;
                state.currentBlobUrl = state.readyQueue[readyIdx].blobUrl;
                state.readyQueue.splice(readyIdx, 1);
            } else if (state.prefetchAudio && state.prefetchBlobUrl) {
                // 兼容旧预取
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
            // 播放中逐步预取后续段落（维护 readyQueue，窗口 2 段）
            ensurePrefetch();
            state.currentAudio.onended = () => {
                playSegment(idx + 1);
            };
            state.currentAudio.onerror = () => {
                showToast && showToast('语音播放出错，跳过本段', 'error');
                playSegment(idx + 1);
            };
            await state.currentAudio.play();
            state.starting = false;   // 第一段真正开始朗读，退出加载阶段
            state.playing = true;
            state.paused = false;
            setButtonState('playing');
        } catch (e) {
            console.error('Edge-TTS 播放失败:', e);
            if (!state.stopRequested) {
                if (e && (e.name === 'NotAllowedError' || /user didn't interact/.test(e.message || ''))) {
                    showToast && showToast('请再次点击播放按钮开始朗读', 'warning');
                } else {
                    showToast && showToast('语音合成失败：' + e.message, 'error');
                }
            }
            finishPlayback();
        }
    }

    // ---------- 段落高亮（朗读中该段文字变绿） ----------
    function highlightParagraph(idx) {
        const content = document.getElementById('storyContent');
        if (!content) return;
        const ps = content.querySelectorAll('p');
        ps.forEach((p, i) => p.classList.toggle('tts-reading', i === idx));
    }
    function highlightClear() {
        const content = document.getElementById('storyContent');
        if (content) content.querySelectorAll('p.tts-reading').forEach(p => p.classList.remove('tts-reading'));
    }
    // 段落状态图标（CSS 伪元素，不占 DOM 空间）：'' 无 / 'loading' 转圈 / 'ready' 已加载
    function setParaStatus(idx, status) {
        const content = document.getElementById('storyContent');
        if (!content) return;
        const ps = content.querySelectorAll('p');
        if (idx < 0) {
            ps.forEach(p => p.classList.remove('tts-loading', 'tts-ready'));
            return;
        }
        const p = ps[idx];
        if (!p) return;
        p.classList.toggle('tts-loading', status === 'loading');
        p.classList.toggle('tts-ready', status === 'ready');
    }

    // ---------- 预合成队列管理 ----------
    function clearReadyQueue() {
        state.readyQueue.forEach(q => {
            try { if (q.audio) q.audio.pause(); } catch (e) { /* ignore */ }
            if (q.blobUrl) URL.revokeObjectURL(q.blobUrl);
        });
        state.readyQueue = [];
    }
    // 播放中逐步预取：当前段之后预合成 2 段
    function ensurePrefetch() {
        if (state.stopRequested) return;
        const from = state.currentIndex + 1;
        const to = Math.min(from + 2, state.segments.length);
        for (let i = from; i < to; i++) {
            if (state.readyQueue.some(q => q.idx === i)) continue;
            setParaStatus(i, 'loading');
            synthForIndex(i).then(b => {
                if (b && !state.stopRequested) {
                    const url = URL.createObjectURL(b);
                    state.readyQueue.push({ idx: i, audio: new Audio(url), blobUrl: url });
                    setParaStatus(i, 'ready');
                }
            }).catch(() => { /* 预取失败忽略，播放时再取 */ });
        }
    }
    // 页面打开预初始化：合成前 1-2 段（不播放），start 时优先使用
    async function prepare(text) {
        state.stopRequested = true;
        if (state.currentAudio) { try { state.currentAudio.pause(); } catch (e) { /* ignore */ } state.currentAudio = null; }
        if (state.currentBlobUrl) { URL.revokeObjectURL(state.currentBlobUrl); state.currentBlobUrl = null; }
        state.prefetchAudio = null;
        state.prefetchBlobUrl = null;
        clearReadyQueue();
        highlightClear();
        state.playing = false;
        state.paused = false;
        state.segments = getSegments(text || '');
        if (state.segments.length === 0) return;
        const n = Math.min(2, state.segments.length); // 前 1-2 段
        for (let i = 0; i < n; i++) {
            setParaStatus(i, 'loading');
            try {
                const b = await synthForIndex(i);
                if (!b) break;
                const url = URL.createObjectURL(b);
                state.readyQueue.push({ idx: i, audio: new Audio(url), blobUrl: url });
                setParaStatus(i, 'ready');
            } catch (e) { break; /* 预初始化失败则停止，播放时再合成 */ }
        }
    }

    function finishPlayback() {
        cleanupAudio();
        highlightClear();
        setParaStatus(-1, '');
        state.playing = false;
        state.paused = false;
        state.starting = false;
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
        clearReadyQueue();
    }

    // ---------- 对外 API ----------
    const EdgeTTS = {
        start(text, callbacks) {
            // 防重：已在播放或加载中，忽略重复点击（避免声音重叠）
            if (state.playing || state.starting) return;
            state.stopRequested = false;
            state.paused = false;
            state.starting = true;
            state.onLoading = callbacks && callbacks.onLoading ? callbacks.onLoading : null;
            state.segments = getSegments(text || '');
            if (state.segments.length === 0) {
                state.starting = false;
                showToast && showToast('没有可朗读的内容', 'warning');
                return;
            }
            state.currentIndex = 0;
            // 进入朗读加载阶段（按钮转圈），保留 prepare 预合成好的 readyQueue
            setButtonState('loading');
            if (state.onLoading) state.onLoading();
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
            highlightClear();
            setParaStatus(-1, '');
            state.playing = false;
            state.paused = false;
            state.starting = false;
            state.segments = [];
            setButtonState('stopped');
        },
        isPlaying() { return state.playing && !state.paused; },
        isPaused() { return state.paused; },
        getSettings() { return Object.assign({}, state.settings); },
        setSettings(s) { state.settings = Object.assign({}, state.settings, s); saveSettings(state.settings); },
        // 页面打开预初始化：合成前 1-2 段语音（不播放），开始朗读时优先使用
        prepare(text) { return prepare(text); },
        // 供测试/调试
        _state: state,
        _synthSegment: synthSegment,
        _parseParagraphDirectives: parseParagraphDirectives,
        _highlightParagraph: highlightParagraph,
        _highlightClear: highlightClear
    };
    window.EdgeTTS = EdgeTTS;

    // ---------- 设置弹窗 ----------
    // 当前语言（中/英）——默认中文
    let currentLang = 'zh';
    function voiceOptionsForLang(lang) {
        const list = (LANG_MAP[lang] || LANG_MAP['zh']).voices;
        return list.map(v => `<option value="${v.id}">${v.label}</option>`).join('');
    }
    function fillVoiceSelect(lang, keepValue) {
        const sel = document.getElementById('edgeTtsVoiceSelect');
        if (!sel) return;
        const prev = keepValue || sel.value;
        const list = (LANG_MAP[lang] || LANG_MAP['zh']).voices;
        sel.innerHTML = list.map(v => `<option value="${v.id}">${v.label}</option>`).join('');
        // 若当前值不在该语言列表，回退为该语言默认声音
        if (!list.some(v => v.id === prev)) {
            sel.value = LANG_MAP[lang].defaultVoice;
        } else {
            sel.value = prev;
        }
        EdgeTTS.setSettings({ voice: sel.value });
    }
    function switchLang(lang) {
        currentLang = lang;
        fillVoiceSelect(lang, state.settings.voice);
        const lbl = document.getElementById('edgeTtsLangLabel');
        if (lbl) lbl.textContent = LANG_MAP[lang].label;
        const sw = document.getElementById('edgeTtsLangSwitch');
        if (sw) sw.checked = (lang === 'zh');
    }
    function buildModalHtml() {
        const styleOptions = STYLES.map(s => `<option value="${s.id}">${s.label}</option>`).join('');
        return `<div class="edge-tts-modal-overlay" id="edgeTtsModalOverlay" style="display:none">
            <div class="edge-tts-modal">
                <div class="edge-tts-modal-header">
                    <h3>语音设置</h3>
                    <button class="edge-tts-modal-close" id="edgeTtsModalClose"><i class="fas fa-times"></i></button>
                </div>
                <div class="edge-tts-modal-body">
                    <div class="edge-tts-field edge-tts-lang-row">
                        <label>朗读语言</label>
                        <div class="edge-tts-lang-switch">
                            <span class="edge-tts-lang-label" id="edgeTtsLangLabel">中文</span>
                            <label class="edge-tts-switch">
                                <input type="checkbox" id="edgeTtsLangSwitch" checked>
                                <span class="edge-tts-slider"></span>
                            </label>
                            <span class="edge-tts-lang-en">English</span>
                        </div>
                    </div>
                    <div class="edge-tts-field">
                        <label>朗读人物</label>
                        <select id="edgeTtsVoiceSelect"></select>
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
        // 根据当前声音自动判断语言
        const lang = String(s.voice || '').startsWith('en') ? 'en' : 'zh';
        switchLang(lang);
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
        const langSwitch = document.getElementById('edgeTtsLangSwitch');
        const voiceSel = document.getElementById('edgeTtsVoiceSelect');
        const styleSel = document.getElementById('edgeTtsStyleSelect');
        const rateRange = document.getElementById('edgeTtsRateRange');
        const rateValue = document.getElementById('edgeTtsRateValue');
        const volRange = document.getElementById('edgeTtsVolumeRange');
        const volValue = document.getElementById('edgeTtsVolumeValue');
        langSwitch.addEventListener('change', () => {
            const lang = langSwitch.checked ? 'zh' : 'en';
            switchLang(lang);
        });
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

    // 设置按钮：给 tts-controls 插入齿轮按钮（静态按钮已存在时也需绑定点击）
    function ensureSettingsButton() {
        const controls = document.querySelector('.tts-controls');
        if (!controls) return;
        let btn = document.getElementById('ttsSettingsButton');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'ttsSettingsButton';
            btn.className = 'tts-button tts-settings-button';
            btn.title = '语音设置';
            btn.innerHTML = '<img src="/img/gear.png" alt="语音设置" class="settings-icon">';
            controls.appendChild(btn);
        }
        if (!btn._edgeTtsBound) {
            btn.addEventListener('click', openSettings);
            btn._edgeTtsBound = true;
        }
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

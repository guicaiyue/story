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
        { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女·温暖亲切）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyiNeural', label: '晓伊（女·甜美可爱）', lang: 'zh-CN' },
        { id: 'zh-CN-YunjianNeural', label: '云健（男·沉稳有力）', lang: 'zh-CN' },
        { id: 'zh-CN-YunxiNeural', label: '云希（男·阳光活力）', lang: 'zh-CN' },
        { id: 'zh-CN-YunxiaNeural', label: '云夏（男·清朗少年）', lang: 'zh-CN' },
        { id: 'zh-CN-YunyangNeural', label: '云扬（男·大气专业）', lang: 'zh-CN' },
        { id: 'zh-CN-liaoning-XiaobeiNeural', label: '小北（女·东北话爽朗）', lang: 'zh-CN' },
        { id: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮（女·陕西话亲切）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaochenNeural', label: '晓辰（女·童声可爱）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaohanNeural', label: '晓涵（女·温柔甜美）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaomengNeural', label: '晓梦（女·梦幻甜美）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaomoNeural', label: '晓墨（女·知性柔和）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoqiuNeural', label: '晓秋（女·清亮活泼）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoruiNeural', label: '晓睿（女·睿智知性）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoshuangNeural', label: '晓双（女·童声活泼）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoxuanNeural', label: '晓萱（女·甜美温柔）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyanNeural', label: '晓颜（女·温婉成熟）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaoyouNeural', label: '晓悠（女·童声天真）', lang: 'zh-CN' },
        { id: 'zh-CN-XiaozhenNeural', label: '晓甄（女·自然平和）', lang: 'zh-CN' },
        { id: 'zh-CN-YunfengNeural', label: '云枫（男·稳重浑厚）', lang: 'zh-CN' },
        { id: 'zh-CN-YunhaoNeural', label: '云皓（男·低沉磁性）', lang: 'zh-CN' },
        { id: 'zh-CN-YunjieNeural', label: '云杰（男·沉稳专业）', lang: 'zh-CN' },
        { id: 'zh-CN-YunlongNeural', label: '云龙（男·大气浑厚）', lang: 'zh-CN' },
        { id: 'zh-CN-YunzeNeural', label: '云泽（男·温和清朗）', lang: 'zh-CN' }
    ];
    const EN_VOICES = [
        { id: 'en-US-AriaNeural', label: 'Aria（女·温暖清晰）', lang: 'en-US' },
        { id: 'en-US-AndrewNeural', label: 'Andrew（男·温暖亲切）', lang: 'en-US' },
        { id: 'en-US-AvaNeural', label: 'Ava（女·清晰友好）', lang: 'en-US' },
        { id: 'en-US-BrianNeural', label: 'Brian（男·自然沉稳）', lang: 'en-US' },
        { id: 'en-US-ChristopherNeural', label: 'Christopher（男·温暖沉稳）', lang: 'en-US' },
        { id: 'en-US-EmmaNeural', label: 'Emma（女·甜美温柔）', lang: 'en-US' },
        { id: 'en-US-EricNeural', label: 'Eric（男·清晰友好）', lang: 'en-US' },
        { id: 'en-US-GuyNeural', label: 'Guy（男·阳光活力）', lang: 'en-US' },
        { id: 'en-US-JennyNeural', label: 'Jenny（女·亲切自然）', lang: 'en-US' },
        { id: 'en-US-MichelleNeural', label: 'Michelle（女·温暖友好）', lang: 'en-US' },
        { id: 'en-US-RogerNeural', label: 'Roger（男·沉稳有力）', lang: 'en-US' },
        { id: 'en-US-SteffanNeural', label: 'Steffan（男·年轻清晰）', lang: 'en-US' },
        { id: 'en-GB-LibbyNeural', label: 'Libby（英音·女·甜美年轻）', lang: 'en-GB' },
        { id: 'en-GB-MaisieNeural', label: 'Maisie（英音·女·活泼友好）', lang: 'en-GB' },
        { id: 'en-GB-RyanNeural', label: 'Ryan（英音·男·温暖自然）', lang: 'en-GB' },
        { id: 'en-GB-SoniaNeural', label: 'Sonia（英音·女·沉稳知性）', lang: 'en-GB' },
        { id: 'en-GB-ThomasNeural', label: 'Thomas（英音·男·沉稳有力）', lang: 'en-GB' },
        { id: 'en-GB-AlfieNeural', label: 'Alfie（英音·男·温暖年轻）', lang: 'en-GB' },
        { id: 'en-GB-BellaNeural', label: 'Bella（英音·女·甜美柔和）', lang: 'en-GB' },
        { id: 'en-GB-ElliotNeural', label: 'Elliot（英音·男·清晰年轻）', lang: 'en-GB' },
        { id: 'en-GB-EthanNeural', label: 'Ethan（英音·男·自然温和）', lang: 'en-GB' },
        { id: 'en-GB-HollieNeural', label: 'Hollie（英音·女·甜美年轻）', lang: 'en-GB' },
        { id: 'en-GB-NoahNeural', label: 'Noah（英音·男·温和年轻）', lang: 'en-GB' },
        { id: 'en-GB-OliverNeural', label: 'Oliver（英音·男·沉稳有力）', lang: 'en-GB' },
        { id: 'en-GB-OliviaNeural', label: 'Olivia（英音·女·温柔优雅）', lang: 'en-GB' }
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
        pitch: 0,
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
    // 音调：数字（设置滑条值，如 +12Hz）或字符串（段落指令/旧设置，如 '0Hz'/'+10Hz'）统一为 Edge-TTS pitch 格式
    function fmtPitch(p) {
        if (typeof p === 'number') return (p > 0 ? '+' : '') + p + 'Hz';
        if (typeof p === 'string' && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(p)) {
            const n = parseFloat(p);
            return (n > 0 ? '+' : '') + n + 'Hz';
        }
        return p || '0Hz';
    }
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
            <prosody rate="${opts.rate}" pitch="${fmtPitch(opts.pitch)}" volume="${opts.volume}">${escaped}</prosody>
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
        singleMode: false,  // true=段落单段播放；false=全文连续播放
        paragraphStartingIndex: -1,  // 单段播放正在合成/加载的段落 idx（防重复点击）
        segments: [],
        currentIndex: 0,
        currentAudio: null,
        currentBlobUrl: null,
        prefetchAudio: null,
        prefetchBlobUrl: null,
        readyQueue: [],   // 预合成队列：[{idx, audio, blobUrl}]（页面打开预初始化前1-3段 + 播放中逐步预取）
        audioCache: {},   // 已播放/已合成段落缓存 {idx: {audio, blobUrl}}——自然播完/暂停/停止均保留，仅 prepare(换文)时清空，避免重复合成
        previewAudio: null,  // 试听播放
        previewBlobUrl: null,
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

    async function playSegment(idx, single) {
        if (state.stopRequested || idx >= state.segments.length) {
            finishPlayback();
            return;
        }
        state.currentIndex = idx;
        // 当前朗读段落文字变绿 + 图标切朗读中
        highlightParagraph(idx);
        setParaStatus(idx, 'reading');
        let audio, blobUrl;
        try {
            // 1) 预取队列 → 移入永久缓存（播完/暂停/停止均保留，仅 prepare 换文时清空）
            const qIdx = state.readyQueue.findIndex(q => q.idx === idx);
            if (qIdx >= 0) {
                const q = state.readyQueue[qIdx];
                state.readyQueue.splice(qIdx, 1);
                state.audioCache[idx] = { audio: q.audio, blobUrl: q.blobUrl };
                audio = q.audio; blobUrl = q.blobUrl;
            } else if (state.audioCache[idx]) {
                // 2) 已播放缓存：直接复用，不重新合成
                audio = state.audioCache[idx].audio;
                blobUrl = state.audioCache[idx].blobUrl;
                audio.currentTime = 0;
            } else if (state.prefetchAudio && state.prefetchBlobUrl) {
                // 3) 旧兼容预取
                state.audioCache[idx] = { audio: state.prefetchAudio, blobUrl: state.prefetchBlobUrl };
                audio = state.prefetchAudio; blobUrl = state.prefetchBlobUrl;
                state.prefetchAudio = null; state.prefetchBlobUrl = null;
            } else {
                // 4) 现场合成
                setParaStatus(idx, 'loading');
                const b = await synthForIndex(idx);
                if (!b) { playSegment(idx + 1, single); return; }
                blobUrl = URL.createObjectURL(b);
                audio = new Audio(blobUrl);
                state.audioCache[idx] = { audio, blobUrl };
            }
            state.currentAudio = audio;
            state.currentBlobUrl = blobUrl;
            // 全文播放中逐步预取后续段落（窗口 3 段）；单段播放不预取
            if (!single) ensurePrefetch();
            audio.onended = () => {
                if (state.stopRequested) return;
                // 本段播完 → 图标回播放态（音频已缓存，点击可再播无需重新合成）
                setParaStatus(idx, 'ready');
                if (single) {
                    singleParagraphFinished(idx);
                } else {
                    playSegment(idx + 1, false);
                }
            };
            audio.onerror = () => {
                showToast && showToast('语音播放出错，跳过本段', 'error');
                playSegment(idx + 1, single);
            };
            await audio.play();
            state.starting = false;   // 第一段真正开始朗读，退出加载阶段
            state.playing = true;
            state.paused = false;
            state.paragraphStartingIndex = -1;
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
    // 段落状态图标（span 占位，图标本体为 CSS 伪元素；absolute 定位不推移文本）
    // 四态：idle 下载 / loading 加载中 / ready 播放 / reading 朗读中
    function setParaStatus(idx, status) {
        const content = document.getElementById('storyContent');
        if (!content) return;
        const ps = content.querySelectorAll('p');
        const apply = (p, st) => {
            const ic = p.querySelector('.tts-para-icon');
            if (!ic) return;
            const cls = st === 'loading' ? 'tts-loading' : st === 'ready' ? 'tts-ready' : st === 'reading' ? 'tts-reading' : 'tts-idle';
            ic.className = 'tts-para-icon ' + cls;
        };
        if (idx < 0) {
            ps.forEach(p => apply(p, 'idle'));
            return;
        }
        const p = ps[idx];
        if (p) apply(p, status);
    }

    // ---------- 缓存管理 ----------
    // 彻底清空所有合成缓存（仅 prepare 换文章时调用；暂停/停止/播完均保留 audioCache 以便段落秒播）
    function clearAllCaches() {
        state.readyQueue.forEach(q => {
            try { if (q.audio) q.audio.pause(); } catch (e) { /* ignore */ }
            if (q.blobUrl) URL.revokeObjectURL(q.blobUrl);
        });
        state.readyQueue = [];
        Object.keys(state.audioCache).forEach(k => {
            const c = state.audioCache[k];
            try { if (c.audio) c.audio.pause(); } catch (e) { /* ignore */ }
            if (c.blobUrl) URL.revokeObjectURL(c.blobUrl);
        });
        state.audioCache = {};
        if (state.previewAudio) { try { state.previewAudio.pause(); } catch (e) { /* ignore */ } state.previewAudio = null; }
        if (state.previewBlobUrl) { URL.revokeObjectURL(state.previewBlobUrl); state.previewBlobUrl = null; }
        if (state.currentAudio) { try { state.currentAudio.pause(); } catch (e) { /* ignore */ } state.currentAudio = null; }
        if (state.currentBlobUrl) { URL.revokeObjectURL(state.currentBlobUrl); state.currentBlobUrl = null; }
        if (state.prefetchAudio) { try { state.prefetchAudio.pause(); } catch (e) { /* ignore */ } state.prefetchAudio = null; }
        if (state.prefetchBlobUrl) { URL.revokeObjectURL(state.prefetchBlobUrl); state.prefetchBlobUrl = null; }
    }
    // 播放中逐步预取：当前段之后预合成 3 段（只入 readyQueue，不重复已有缓存）
    function ensurePrefetch() {
        if (state.stopRequested) return;
        const from = state.currentIndex + 1;
        const to = Math.min(from + 3, state.segments.length);
        for (let i = from; i < to; i++) {
            if (state.readyQueue.some(q => q.idx === i) || state.audioCache[i]) continue;
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
    // 页面打开预初始化：合成前 1-3 段（不播放），start 时优先使用
    async function prepare(text) {
        state.stopRequested = true;
        clearAllCaches();
        highlightClear();
        state.playing = false;
        state.paused = false;
        state.singleMode = false;
        state.segments = getSegments(text || '');
        if (state.segments.length === 0) return;
        const n = Math.min(3, state.segments.length); // 前 1-3 段
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

    // 全文/单段自然播完（不清缓存，段落图标保留 ready 可再播）
    function finishPlayback() {
        if (state.currentAudio) { try { state.currentAudio.pause(); } catch (e) { /* ignore */ } }
        state.currentAudio = null;
        state.currentBlobUrl = null; // 不 revoke（audioCache 中仍被 Audio 对象持有）
        highlightClear();
        state.playing = false;
        state.paused = false;
        state.starting = false;
        state.singleMode = false;
        state.paragraphStartingIndex = -1;
        setButtonState('stopped');
    }
    // 单段播放完成：仅停止，缓存保留
    function singleParagraphFinished(idx) {
        state.currentAudio = null;
        state.currentBlobUrl = null;
        highlightClear();
        state.playing = false;
        state.paused = false;
        state.starting = false;
        state.singleMode = false;
        state.paragraphStartingIndex = -1;
        setParaStatus(-1, '');
        setParaStatus(idx, 'ready');
        setButtonState('stopped');
    }
    // 立即暂停当前播放（不清理缓存；段落播放用）
    function haltPlayback() {
        state.stopRequested = true;
        if (state.previewAudio) { try { state.previewAudio.pause(); } catch (e) { /* ignore */ } }
        if (state.currentAudio) {
            try { state.currentAudio.pause(); } catch (e) { /* ignore */ }
            state.currentAudio = null;
        }
        state.currentBlobUrl = null;
        state.playing = false;
        state.paused = false;
        state.starting = false;
        state.singleMode = false;
        state.paragraphStartingIndex = -1;
        highlightClear();
        setButtonState('stopped');
    }
    // 点击段落图标：单段播放（防重；全文/他段在播先暂停）
    async function playParagraph(idx) {
        if (!state.segments || idx >= state.segments.length) return;
        // 防重：该段正在播放或正在合成
        if (state.singleMode && (state.playing && state.currentIndex === idx || state.starting && state.paragraphStartingIndex === idx)) return;
        // 全文朗读或其他段播放中 → 先暂停（不清缓存）
        if (state.playing || state.starting) haltPlayback();
        state.stopRequested = false;
        state.singleMode = true;
        state.paragraphStartingIndex = idx;
        state.starting = true;
        // 已缓存则直接播放（不显示加载态，避免闪一下）
        if (!state.audioCache[idx] && !state.readyQueue.some(q => q.idx === idx)) {
            setParaStatus(idx, 'loading');
        }
        setButtonState('loading');
        await playSegment(idx, true);
    }
    // 试听：按当前设置合成指定文本
    async function preview(text, settings) {
        haltPlayback();
        const opts = Object.assign({}, state.settings, settings || {});
        const full = Object.assign({}, opts, {
            rate: parseFloat(opts.rate) || 1.0,
            pitch: fmtPitch(opts.pitch),
            volume: parseInt(opts.volume, 10) || 100
        });
        try {
            const b = await synthSegment(text, full);
            if (state.previewBlobUrl) { URL.revokeObjectURL(state.previewBlobUrl); state.previewBlobUrl = null; }
            const url = URL.createObjectURL(b);
            const audio = new Audio(url);
            state.previewAudio = audio;
            state.previewBlobUrl = url;
            audio.onended = () => {
                if (state.previewBlobUrl) { URL.revokeObjectURL(state.previewBlobUrl); state.previewBlobUrl = null; }
                state.previewAudio = null;
            };
            await audio.play();
            return true;
        } catch (e) {
            showToast && showToast('试听失败：' + e.message, 'error');
            return false;
        }
    }

    // ---------- 对外 API ----------
    const EdgeTTS = {
        start(text, callbacks) {
            // 防重：已在播放或加载中，忽略重复点击（避免声音重叠）
            if (state.playing || state.starting) return;
            state.stopRequested = false;
            state.paused = false;
            state.starting = true;
            state.singleMode = false;
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
            playSegment(0, false);
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
            haltPlayback();
            setParaStatus(-1, '');
            state.segments = [];
        },
        isPlaying() { return state.playing && !state.paused; },
        isPaused() { return state.paused; },
        getSettings() { return Object.assign({}, state.settings); },
        setSettings(s) { state.settings = Object.assign({}, state.settings, s); saveSettings(state.settings); },
        // 页面打开预初始化：合成前 1-3 段语音（不播放），开始朗读时优先使用
        prepare(text) { return prepare(text); },
        // 供测试/调试
        _state: state,
        _synthSegment: synthSegment,
        _parseParagraphDirectives: parseParagraphDirectives,
        _highlightParagraph: highlightParagraph,
        _highlightClear: highlightClear,
        // 段落单段播放（点击段落图标）
        playParagraph: playParagraph,
        // 试听：按当前配置合成指定文本
        preview: preview,
        // 立即暂停当前播放（保留缓存）
        halt: haltPlayback
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
                    <h3>朗读语言</h3>
                    <div class="edge-tts-lang-switch">
                        <span class="edge-tts-lang-label" id="edgeTtsLangLabel">中文</span>
                        <label class="edge-tts-switch">
                            <input type="checkbox" id="edgeTtsLangSwitch" checked>
                            <span class="edge-tts-slider"></span>
                        </label>
                        <span class="edge-tts-lang-en">English</span>
                    </div>
                    <button class="edge-tts-modal-close" id="edgeTtsModalClose"><i class="fas fa-times"></i></button>
                </div>
                <div class="edge-tts-modal-body">
                    <div class="edge-tts-row">
                        <div class="edge-tts-field">
                            <label>朗读人物</label>
                            <select id="edgeTtsVoiceSelect"></select>
                        </div>
                        <div class="edge-tts-field">
                            <label>语言风格</label>
                            <select id="edgeTtsStyleSelect">${styleOptions}</select>
                        </div>
                    </div>
                    <div class="edge-tts-row">
                        <div class="edge-tts-field">
                            <label>语速 <span class="edge-tts-value" id="edgeTtsRateValue">1.00</span></label>
                            <input type="range" id="edgeTtsRateRange" min="0.5" max="2.0" step="0.05" value="1.0">
                        </div>
                        <div class="edge-tts-field">
                            <label>音调 <span class="edge-tts-value" id="edgeTtsPitchValue">0</span></label>
                            <input type="range" id="edgeTtsPitchRange" min="-50" max="50" step="1" value="0">
                        </div>
                    </div>
                    <div class="edge-tts-row edge-tts-btn-row">
                        <button class="edge-tts-btn edge-tts-btn-secondary" id="edgeTtsPreviewBtn">试听</button>
                    </div>
                    <div class="edge-tts-field">
                        <label>试听文本</label>
                        <textarea id="edgeTtsPreviewText" rows="3" placeholder="输入想试听的文字…"></textarea>
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
        document.getElementById('edgeTtsRateValue').textContent = parseFloat(s.rate).toFixed(2);
        const pitch = parseInt(s.pitch, 10) || 0;
        document.getElementById('edgeTtsPitchRange').value = pitch;
        document.getElementById('edgeTtsPitchValue').textContent = pitch;
        // 试听文本：首次打开默认取本篇文章第一段（之后保留用户编辑）
        const previewText = document.getElementById('edgeTtsPreviewText');
        if (!previewText.dataset.init && state.segments && state.segments.length) {
            previewText.value = state.segments[0];
            previewText.dataset.init = '1';
        }
        overlay.style.display = 'flex';
    }

    function closeSettings() {
        const overlay = document.getElementById('edgeTtsModalOverlay');
        if (overlay) overlay.style.display = 'none';
        // 关闭弹窗时停止正在试听的语音
        if (state.previewAudio) {
            try { state.previewAudio.pause(); } catch (e) { /* ignore */ }
            state.previewAudio = null;
        }
        if (state.previewBlobUrl) {
            URL.revokeObjectURL(state.previewBlobUrl);
            state.previewBlobUrl = null;
        }
        const btn = document.getElementById('edgeTtsPreviewBtn');
        if (btn) btn.disabled = false;
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
        const pitchRange = document.getElementById('edgeTtsPitchRange');
        const pitchValue = document.getElementById('edgeTtsPitchValue');
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
        pitchRange.addEventListener('input', () => {
            pitchValue.textContent = pitchRange.value;
            EdgeTTS.setSettings({ pitch: parseInt(pitchRange.value, 10) });
        });
        // 试听：按当前弹窗配置合成试听文本
        document.getElementById('edgeTtsPreviewBtn').addEventListener('click', async () => {
            const text = document.getElementById('edgeTtsPreviewText').value.trim();
            if (!text) { showToast && showToast('请输入试听文本', 'warning'); return; }
            const btn = document.getElementById('edgeTtsPreviewBtn');
            btn.disabled = true;
            const ok = await EdgeTTS.preview(text, state.settings);
            btn.disabled = false;
            if (ok) showToast && showToast('试听中…', 'success');
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

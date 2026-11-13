/* 小故事铺 · 安卓原型交互脚本
   9 屏 hash 路由、底部 tab、播放器、定时倒计时、收藏、家长门、家长中心、夜间模式。
   全部界面数据与状态都在这里，DOM 结构由 index.html 提供。 */

(function () {
  'use strict';

  /* ============================================================
     一、数据
     ============================================================ */

  var AGE_LABEL = { '3-6': '3–6 岁', '6-9': '6–9 岁', '9+': '9+ 岁' };

  var CATEGORIES = [
    { id: 'folk', name: '民间故事', icon: 'moon' },
    { id: 'fable', name: '经典寓言', icon: 'feather' },
    { id: 'nature', name: '自然认知', icon: 'leaf' },
    { id: 'wisdom', name: '智慧启蒙', icon: 'bulb' },
    { id: 'courage', name: '勇气成长', icon: 'mountain' },
    { id: 'warmth', name: '温暖友情', icon: 'heart' },
    { id: 'imagine', name: '想象世界', icon: 'sparkle' }
  ];

  var SCENES = [
    { id: 'sleep', name: '哄睡', icon: 'moon', hint: '节奏慢，越听越困' },
    { id: 'wake', name: '叫早', icon: 'sunrise', hint: '轻轻叫醒，不吵不闹' },
    { id: 'out', name: '出行', icon: 'car', hint: '路上的短故事' }
  ];

  var STORIES = [
    {
      id: 'monkey-moon', title: '猴子捞月亮', age: '3-6', minutes: 5, cat: 'folk', scene: 'sleep',
      origin: '中国民间故事', motif: 'monkey', ground: 0,
      why: '节奏慢，结尾安静，适合今晚睡前',
      intro: '一只小猴子在井边玩，看见井里有个月亮，以为月亮掉进井里了。猴子们一个拉着一个，从树上倒挂下来去捞月亮。捞了半天，月亮还是好好地挂在天上。'
    },
    {
      id: 'horse-river', title: '小马过河', age: '3-6', minutes: 6, cat: 'courage', scene: 'wake',
      origin: '中国经典童话', motif: 'horse', ground: 1,
      why: '讲完心里会亮一点点',
      intro: '小马要帮妈妈把半袋麦子送到磨坊，路上遇到一条小河。牛伯伯说水很浅，小松鼠说水很深。小马没有听谁的话就下结论，而是一步一步自己试着走过去，才发现河水既不像牛伯伯说的那么浅，也不像小松鼠说的那么深。'
    },
    {
      id: 'tadpole', title: '小蝌蚪找妈妈', age: '3-6', minutes: 4, cat: 'nature', scene: 'wake',
      origin: '中国经典童话', motif: 'tadpole', ground: 2,
      why: '水里的小发现，早上听正合适',
      intro: '小蝌蚪们一出生就找不到妈妈了。它们问过鸭子、问过乌龟、问过白鹅，一路游一路长，长出了后腿和前腿，最后变成小青蛙，才认出了自己的妈妈。'
    },
    {
      id: 'crow-water', title: '乌鸦喝水', age: '3-6', minutes: 3, cat: 'fable', scene: 'out',
      origin: '伊索寓言', motif: 'crow', ground: 3,
      why: '短，路上听刚刚好',
      intro: '一只乌鸦口渴了，找到一个瓶子里有水，可是瓶口太小，嘴伸不进去。它没有走开，而是一颗一颗地把小石子衔进瓶里，水面慢慢升高，乌鸦终于喝到了水。'
    },
    {
      id: 'tortoise', title: '龟兔赛跑', age: '3-6', minutes: 4, cat: 'fable', scene: 'wake',
      origin: '伊索寓言', motif: 'tortoise', ground: 2,
      why: '慢慢来，也能走到终点',
      intro: '兔子跑得快，一路上还睡了一觉；乌龟走得慢，却一直没有停。等兔子醒来的时候，乌龟已经越过了终点线。'
    },
    {
      id: 'gecko', title: '小壁虎借尾巴', age: '3-6', minutes: 5, cat: 'nature', scene: 'sleep',
      origin: '中国经典科学童话', motif: 'gecko', ground: 1,
      why: '认识小动物的小知识',
      intro: '小壁虎的尾巴断了，它去问小鱼、老牛和燕子借尾巴，大家都没有多余的尾巴可以借。回到家，它发现自己又长出了一条新尾巴。'
    },
    {
      id: 'papaya', title: '咕咚来了', age: '3-6', minutes: 4, cat: 'folk', scene: 'sleep',
      origin: '中国民间故事', motif: 'papaya', ground: 3,
      why: '轻轻笑的结尾，适合睡前',
      intro: '一只熟透的木瓜掉进湖里，发出“咕咚”一声。小兔子听见了，一边跑一边喊“咕咚来了”，狐狸、猴子、大象都跟着跑起来。最后大家回到湖边一看，原来只是一个木瓜。'
    },
    {
      id: 'snowman', title: '雪孩子', age: '6-9', minutes: 12, cat: 'warmth', scene: 'sleep',
      origin: '中国经典童话', motif: 'snowman', ground: 2,
      why: '温柔的故事，听完好入睡',
      intro: '小兔堆了一个雪孩子，雪孩子陪它玩了一整个白天。夜里小兔家着了火，雪孩子冲进屋子把小兔救了出来，自己却慢慢化成了一摊清水，变成天上的云。'
    },
    {
      id: 'jar', title: '司马光砸缸', age: '6-9', minutes: 6, cat: 'wisdom', scene: 'out',
      origin: '中国历史故事', motif: 'jar', ground: 0,
      why: '遇到事情，先想办法',
      intro: '一群孩子在院子里玩，一个孩子爬上大水缸，不小心掉了进去。别的孩子都吓跑了，司马光搬起一块石头砸破了水缸，水流出来，孩子得救了。'
    },
    {
      id: 'elephant', title: '曹冲称象', age: '9+', minutes: 7, cat: 'wisdom', scene: 'out',
      origin: '中国历史故事', motif: 'elephant', ground: 1,
      why: '动动脑筋的古代故事',
      intro: '有人送来一头大象，大家都想知道它有多重，可是没有那么大的秤。曹冲说：把大象牵到船上，记下水面的位置，再换成石头，石头有多重，大象就有多重。'
    },
    {
      id: 'paper-letter', title: '纸片上的字', age: '9+', minutes: 7, cat: 'imagine', scene: 'sleep',
      origin: '儿童文学短篇', motif: 'paper', ground: 3,
      why: '字里有光，适合大一点的孩子',
      intro: '一张纸片落在窗台上，上面写着一个字。孩子跟着这个字走过巷子、走过小桥，遇到几个愿意一起猜的人，一个字一个字地，把这张纸片读完了。'
    }
  ];

  /* 本周播放报告：最近 7 天，截止到今天（示例数据，日期取真实日期） */
  var WEEK_PATTERN = [
    { m: 22, ids: ['monkey-moon', 'crow-water'] },
    { m: 14, ids: ['horse-river'] },
    { m: 26, ids: ['snowman'] },
    { m: 0, ids: [] },
    { m: 18, ids: ['tortoise', 'gecko'] },
    { m: 12, ids: ['papaya'] },
    { m: 30, ids: ['paper-letter'] }
  ];

  var HISTORY_SEED = [
    { id: 'paper-letter', when: '昨天 21:05' },
    { id: 'monkey-moon', when: '昨天 20:42' },
    { id: 'snowman', when: '前天 20:58' },
    { id: 'crow-water', when: '周一 07:20' }
  ];

  var TIMER_OPTIONS = [
    { value: '15', label: '15 分钟' },
    { value: '30', label: '30 分钟' },
    { value: '45', label: '45 分钟' },
    { value: 'end', label: '听完这集' },
    { value: 'off', label: '关闭' }
  ];

  var DUR_FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'short', label: '5 分钟以内' },
    { id: 'mid', label: '5–10 分钟' },
    { id: 'long', label: '10 分钟以上' }
  ];

  /* ============================================================
     二、图标（同一套线性图标，1.8 描边）
     ============================================================ */

  var ICONS = {
    home: '<path d="M4 11.4 12 4.6l8 6.8V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19z"/><path d="M9.6 20.6v-5.8h4.8v5.8"/>',
    grid: '<path d="M12 3.8 20 8l-8 4.2L4 8z"/><path d="M4.6 12.4 12 16.2l7.4-3.8"/><path d="M4.6 16.4 12 20.2l7.4-3.8"/>',
    user: '<path d="M12 12.2a3.9 3.9 0 1 0 0-7.8 3.9 3.9 0 0 0 0 7.8Z"/><path d="M4.9 20.4c1.4-3.4 4-5.1 7.1-5.1s5.7 1.7 7.1 5.1"/>',
    play: '<path d="M8.8 5.6 18.4 12 8.8 18.4z" fill="currentColor" stroke-linejoin="round"/>',
    pause: '<path d="M9 5.6h2.4v12.8H9zM12.6 5.6H15v12.8h-2.4z" fill="currentColor" stroke="none"/>',
    back: '<path d="M14.6 5.6 8.2 12l6.4 6.4"/>',
    chev: '<path d="M9.4 5.6 15.8 12l-6.4 6.4"/>',
    heart: '<path d="M12 19.6C7.4 16.5 4.2 13.7 4.2 10.5c0-2.3 1.8-4.1 4.1-4.1 1.5 0 2.8.8 3.7 2 .9-1.2 2.2-2 3.7-2 2.3 0 4.1 1.8 4.1 4.1 0 3.2-3.2 6-7.8 9.1Z"/>',
    heartFill: '<path d="M12 19.6C7.4 16.5 4.2 13.7 4.2 10.5c0-2.3 1.8-4.1 4.1-4.1 1.5 0 2.8.8 3.7 2 .9-1.2 2.2-2 3.7-2 2.3 0 4.1 1.8 4.1 4.1 0 3.2-3.2 6-7.8 9.1Z" fill="currentColor" stroke="none"/>',
    clock: '<path d="M12 20.8a8.8 8.8 0 1 0 0-17.6 8.8 8.8 0 0 0 0 17.6Z"/><path d="M12 7.6V12l3.2 1.9"/>',
    moon: '<path d="M20.2 14.8A8.5 8.5 0 0 1 9.4 4a8.7 8.7 0 1 0 10.8 10.8Z"/>',
    sun: '<path d="M12 16.6a4.6 4.6 0 1 0 0-9.2 4.6 4.6 0 0 0 0 9.2Z"/><path d="M12 2.6v2.2M12 19.2v2.2M4.6 12H2.4M21.6 12h-2.2M6.8 6.8 5.2 5.2M18.8 18.8l-1.6-1.6M6.8 17.2l-1.6 1.6M18.8 5.2l-1.6 1.6"/>',
    back15: '<path d="M11.6 5.4 6 10.2l5.6 4.8"/><path d="M6.6 10.2h7a5.5 5.5 0 0 1 0 11H9.2"/>',
    fwd15: '<path d="M12.4 5.4 18 10.2l-5.6 4.8"/><path d="M17.4 10.2h-7a5.5 5.5 0 0 0 0 11h4.4"/>',
    alert: '<path d="M12 4.6 21 19.4H3z"/><path d="M12 9.8v4.4"/><path d="M12 17.2h.01"/>',
    shield: '<path d="M12 3.8 19 6.4v5.4c0 4.2-2.8 7.3-7 8.8-4.2-1.5-7-4.6-7-8.8V6.4z"/><path d="M9 12.2 11.3 14.5 15.4 10.4"/>',
    edit: '<path d="M4.4 19.6h3.8L19.4 8.4a2.7 2.7 0 0 0-3.8-3.8L4.4 15.8z"/><path d="M14.2 5.8 18 9.6"/>',
    chart: '<path d="M4 20h16"/><path d="M7.4 20v-5.6M12 20V7.4M16.6 20v-9"/>',
    feather: '<path d="M18.8 5.2C18.8 12 14.4 16 8.6 16H6.2L4.8 19.4"/><path d="M18.8 5.2C11.6 5.2 8.4 9.2 8.4 13.2"/>',
    leaf: '<path d="M5 19.4C5 10.8 10.4 5 20 5c0 9.4-5.6 14.4-15 14.4z"/><path d="M6.6 17.8C9.6 14.4 13 12 17 10.6"/>',
    bulb: '<path d="M12 3.6a5.9 5.9 0 0 1 3.4 10.7v2.5H8.6v-2.5A5.9 5.9 0 0 1 12 3.6Z"/><path d="M9.6 19.8h4.8"/>',
    mountain: '<path d="M3 19.4h18L14.6 7.8l-3.3 6-2.2-3.6z"/>',
    sparkle: '<path d="M11 3.8l1.8 5.4 5.4 1.8-5.4 1.8L11 18.2 9.2 12.8 3.8 11l5.4-1.8z"/><path d="M18.4 16.4l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z"/>',
    sunrise: '<path d="M4 19.4h16"/><path d="M12 3.8v4.4"/><path d="M6.6 8.6 5.2 7.2M17.4 8.6l1.4-1.4"/><path d="M4 15.8h2.2M17.8 15.8H20"/><path d="M8.4 19.4a3.6 3.6 0 0 1 7.2 0"/>',
    car: '<path d="M4.2 16.4h15.6v-3.2l-1.9-4.4H6.1l-1.9 4.4z"/><path d="M7 19.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8ZM17 19.4a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"/>'
  };

  function icon(name, cls, label) {
    var body = ICONS[name] || '';
    var attr = label
      ? ' role="img" aria-label="' + esc(label) + '"'
      : ' aria-hidden="true"';
    return '<svg class="od-icon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' +
      ' focusable="false"' + attr + '>' + body + '</svg>';
  }

  /* ============================================================
     三、封面插画（剪纸风，代码绘制；不使用外部图片）
     ============================================================ */

  var GROUNDS = [
    { bg: '#F1E4D0', ink: '#8A5A38', accent: '#C0623A' },
    { bg: '#EADCC6', ink: '#5E4A3C', accent: '#B4693F' },
    { bg: '#F4EAD9', ink: '#3A3330', accent: '#C98A4B' },
    { bg: '#E6D6BE', ink: '#7A4C2E', accent: '#A9563A' }
  ];

  var MOTIFS = {
    monkey: function (g) {
      return '<circle cx="150" cy="128" r="54" fill="' + g.accent + '" opacity=".85"/>' +
        '<circle cx="170" cy="112" r="46" fill="' + g.bg + '"/>' +
        '<path d="M18 192h264" stroke="' + g.ink + '" stroke-width="12" stroke-linecap="round"/>' +
        '<g fill="' + g.ink + '">' +
        '<path d="M126 214v-30M174 214v-30" stroke="' + g.ink + '" stroke-width="12" stroke-linecap="round" fill="none"/>' +
        '<circle cx="150" cy="208" r="30"/>' +
        '<circle cx="120" cy="200" r="12"/><circle cx="180" cy="200" r="12"/>' +
        '<ellipse cx="150" cy="266" rx="38" ry="46"/>' +
        '<path d="M150 306c30 4 40 26 22 42" stroke="' + g.ink + '" stroke-width="13" stroke-linecap="round" fill="none"/>' +
        '</g>' +
        '<circle cx="139" cy="202" r="4.5" fill="' + g.bg + '"/><circle cx="161" cy="202" r="4.5" fill="' + g.bg + '"/>';
    },
    horse: function (g) {
      return '<path d="M36 328q28-13 56 0t56 0 56 0 56 0" fill="none" stroke="' + g.accent + '" stroke-width="7" stroke-linecap="round" opacity=".85"/>' +
        '<g fill="' + g.ink + '">' +
        '<ellipse cx="146" cy="230" rx="62" ry="34"/>' +
        '<path d="M186 204l16-50 34 8-6 40z"/>' +
        '<ellipse cx="224" cy="164" rx="26" ry="22"/>' +
        '<path d="M212 142l-4-22 16 10z"/><path d="M230 142l8-20 6 18z"/>' +
        '<rect x="104" y="254" width="16" height="54" rx="8"/>' +
        '<rect x="134" y="254" width="16" height="54" rx="8"/>' +
        '<rect x="166" y="254" width="16" height="54" rx="8"/>' +
        '<path d="M86 214c-30 4-38 30-24 56 2-22 12-32 30-32z"/>' +
        '</g>' +
        '<circle cx="232" cy="158" r="4" fill="' + g.bg + '"/>';
    },
    tadpole: function (g) {
      function one(cx, cy, s) {
        return '<g transform="translate(' + cx + ' ' + cy + ') scale(' + s + ')">' +
          '<ellipse cx="0" cy="0" rx="26" ry="22" fill="' + g.ink + '"/>' +
          '<path d="M24 0c16-14 30-6 38 12" fill="none" stroke="' + g.ink + '" stroke-width="10" stroke-linecap="round"/>' +
          '<circle cx="-6" cy="-5" r="4" fill="' + g.bg + '"/></g>';
      }
      return one(104, 150, 1) + one(196, 210, 0.82) + one(126, 274, 0.68) +
        '<path d="M30 330q30-14 60 0t60 0 60 0 60 0" fill="none" stroke="' + g.accent + '" stroke-width="7" stroke-linecap="round" opacity=".8"/>';
    },
    crow: function (g) {
      return '<g fill="' + g.ink + '">' +
        '<ellipse cx="150" cy="168" rx="52" ry="36"/>' +
        '<circle cx="200" cy="146" r="24"/>' +
        '<path d="M222 142l30 8-28 14z"/>' +
        '<path d="M100 158c-26-4-44-16-54-34 22 4 42 8 58 8z"/>' +
        '<path d="M132 200l-8 50M166 200l8 50" stroke="' + g.ink + '" stroke-width="9" stroke-linecap="round" fill="none"/>' +
        '</g>' +
        '<circle cx="206" cy="138" r="4" fill="' + g.bg + '"/>' +
        '<path d="M92 250h116l-14 74h-88z" fill="' + g.accent + '" opacity=".9"/>' +
        '<path d="M92 250h116" stroke="' + g.ink + '" stroke-width="11" stroke-linecap="round"/>' +
        '<g fill="' + g.bg + '"><circle cx="128" cy="288" r="6"/><circle cx="150" cy="302" r="7"/><circle cx="172" cy="284" r="5"/></g>';
    },
    tortoise: function (g) {
      return '<path d="M42 308h216" stroke="' + g.accent + '" stroke-width="8" stroke-linecap="round" opacity=".85"/>' +
        '<g fill="' + g.ink + '">' +
        '<rect x="128" y="266" width="20" height="38" rx="10"/>' +
        '<rect x="170" y="266" width="20" height="38" rx="10"/>' +
        '<path d="M62 266c0-52 40-88 90-88s90 36 90 88z"/>' +
        '<circle cx="246" cy="248" r="22"/>' +
        '</g>' +
        '<path d="M96 250l18-26 20 14 22-28 22 28 20-16 18 26" fill="none" stroke="' + g.bg + '" stroke-width="7" stroke-linecap="round" opacity=".75"/>' +
        '<circle cx="252" cy="242" r="4" fill="' + g.bg + '"/>';
    },
    gecko: function (g) {
      return '<path d="M40 322h220" stroke="' + g.accent + '" stroke-width="8" stroke-linecap="round" opacity=".8"/>' +
        '<g fill="' + g.ink + '">' +
        '<ellipse cx="140" cy="212" rx="54" ry="27" transform="rotate(-14 140 212)"/>' +
        '<circle cx="196" cy="196" r="23"/>' +
        '<path d="M88 224c-30 12-44 34-42 62" fill="none" stroke="' + g.ink + '" stroke-width="16" stroke-linecap="round"/>' +
        '<path d="M126 234l-16 30M154 240l-8 32M118 188l-14-28M148 182l-6-30" stroke="' + g.ink + '" stroke-width="12" stroke-linecap="round" fill="none"/>' +
        '</g>' +
        '<circle cx="202" cy="190" r="4.5" fill="' + g.bg + '"/>';
    },
    papaya: function (g) {
      return '<path d="M150 318V168" stroke="' + g.ink + '" stroke-width="16" stroke-linecap="round"/>' +
        '<g fill="' + g.ink + '">' +
        '<path d="M150 174c-34-6-56-28-60-58 32 4 56 24 60 58z"/>' +
        '<path d="M150 174c34-10 52-34 52-64-32 8-52 30-52 64z"/>' +
        '<path d="M150 208c-30 0-50-14-58-34 28-2 48 10 58 34z"/>' +
        '</g>' +
        '<ellipse cx="126" cy="250" rx="22" ry="30" fill="' + g.accent + '"/>' +
        '<ellipse cx="176" cy="264" rx="19" ry="26" fill="' + g.accent + '" opacity=".85"/>' +
        '<path d="M44 330h212" stroke="' + g.ink + '" stroke-width="8" stroke-linecap="round" opacity=".45"/>';
    },
    snowman: function (g) {
      return '<g fill="#FBF7F0" stroke="' + g.ink + '" stroke-width="3.5">' +
        '<circle cx="150" cy="262" r="54"/>' +
        '<circle cx="150" cy="176" r="38"/>' +
        '</g>' +
        '<path d="M126 138v-16h48v16z" fill="' + g.ink + '"/>' +
        '<path d="M112 138h76v26h-76z" fill="' + g.ink + '"/>' +
        '<path d="M118 208c22 12 42 12 64 0" stroke="' + g.accent + '" stroke-width="11" fill="none" stroke-linecap="round"/>' +
        '<circle cx="138" cy="168" r="5" fill="' + g.ink + '"/><circle cx="162" cy="168" r="5" fill="' + g.ink + '"/>' +
        '<path d="M150 180l16 9-16 9z" fill="' + g.accent + '"/>' +
        '<g fill="' + g.ink + '" opacity=".4">' +
        '<circle cx="68" cy="112" r="6"/><circle cx="234" cy="96" r="5"/>' +
        '<circle cx="250" cy="178" r="6"/><circle cx="54" cy="198" r="5"/>' +
        '</g>';
    },
    jar: function (g) {
      return '<path d="M150 62l-14 26M150 62l14 26M108 84l-10 24M192 84l10 24" stroke="' + g.accent + '" stroke-width="7" stroke-linecap="round" fill="none"/>' +
        '<path d="M104 122h92l14 42c10 30 8 62-6 84-10 16-30 26-54 26s-44-10-54-26c-14-22-16-54-6-84z" fill="' + g.ink + '"/>' +
        '<path d="M96 122h108" stroke="' + g.ink + '" stroke-width="15" stroke-linecap="round"/>' +
        '<path d="M92 244c14 10 30 12 46 6 20-8 40-8 60 4v20c-8 16-26 26-50 26s-42-10-50-26z" fill="' + g.accent + '" opacity=".65"/>' +
        '<path d="M60 320h180" stroke="' + g.accent + '" stroke-width="9" stroke-linecap="round" opacity=".85"/>';
    },
    elephant: function (g) {
      return '<g fill="' + g.ink + '">' +
        '<ellipse cx="142" cy="214" rx="72" ry="52"/>' +
        '<circle cx="214" cy="186" r="42"/>' +
        '<ellipse cx="200" cy="196" rx="26" ry="30" fill="' + g.bg + '" opacity=".35"/>' +
        '<path d="M244 210c12 28 8 50-8 62-8 6-18 4-20-4-2-6 4-10 10-12 9-4 11-16 6-26z"/>' +
        '<rect x="98" y="254" width="20" height="58" rx="10"/>' +
        '<rect x="136" y="254" width="20" height="58" rx="10"/>' +
        '<rect x="174" y="254" width="20" height="58" rx="10"/>' +
        '<path d="M72 198c-18-6-26-18-28-30 16 6 26 8 36 6z"/>' +
        '</g>' +
        '<circle cx="228" cy="172" r="5" fill="' + g.bg + '"/>' +
        '<path d="M50 322h200" stroke="' + g.accent + '" stroke-width="8" stroke-linecap="round" opacity=".7"/>';
    },
    paper: function (g) {
      return '<g transform="rotate(-7 150 204)">' +
        '<rect x="74" y="100" width="152" height="200" rx="12" fill="#FBF7F0" stroke="' + g.ink + '" stroke-opacity=".38" stroke-width="3"/>' +
        '<path d="M104 148h92M104 182h92M104 216h66" stroke="' + g.ink + '" stroke-width="9" stroke-linecap="round" opacity=".7"/>' +
        '<path d="M104 252h44" stroke="' + g.accent + '" stroke-width="9" stroke-linecap="round"/>' +
        '</g>' +
        '<path d="M232 62l9 20 20 9-20 9-9 20-9-20-20-9 20-9z" fill="' + g.accent + '"/>';
    }
  };

  function coverArt(story) {
    var g = GROUNDS[(story.ground || 0) % GROUNDS.length];
    var motif = MOTIFS[story.motif] ? MOTIFS[story.motif](g) : '';
    return '<svg class="cover-art" viewBox="0 0 300 400" role="img" aria-label="《' + esc(story.title) + '》封面插画">' +
      '<rect width="300" height="400" fill="' + g.bg + '"/>' +
      '<rect x="16" y="16" width="268" height="368" rx="12" fill="none" stroke="' + g.ink + '" stroke-opacity=".2" stroke-width="2"/>' +
      motif +
      '<circle cx="150" cy="358" r="5" fill="' + g.accent + '" opacity=".8"/>' +
      '</svg>';
  }

  function splashArt() {
    return '<svg viewBox="0 0 132 112" role="img" aria-label="小故事铺标志">' +
      '<circle cx="66" cy="26" r="17" fill="#F1D9BE"/>' +
      '<circle cx="74" cy="20" r="15" fill="#FBF7F0"/>' +
      '<path d="M12 50c18-9 36-9 54 2v46c-18-11-36-11-54-2z" fill="#D98E5A"/>' +
      '<path d="M120 50c-18-9-36-9-54 2v46c18-11 36-11 54-2z" fill="#3A3330"/>' +
      '<path d="M66 52v46" stroke="#FBF7F0" stroke-width="3" stroke-linecap="round"/>' +
      '</svg>';
  }

  /* ============================================================
     四、状态
     ============================================================ */

  var state = {
    route: 'launch',
    stack: [],
    storyId: null,
    scene: 'sleep',
    filter: { age: 'all', dur: 'all', cat: 'all' },
    favorites: ['snowman', 'monkey-moon'],
    progress: { 'monkey-moon': 130, 'horse-river': 96 },
    history: HISTORY_SEED.slice(),
    profile: { name: '小满', months: 56, age: '3-6' },
    parent: { limit: 30, age: 'all' },
    night: { auto: true, override: null },
    gate: { q: null, answer: '', error: '' },
    queue: [],
    lastList: [],
    started: false,
    player: { id: 'monkey-moon', pos: 130, playing: false, sleepMode: 'off', sleepLeft: 0, autoNext: true },
    timer: null,
    toastTimer: null,
    splashDone: false
  };

  var els = {};
  var scrollMemo = {};
  var suppressHash = false;

  /* ============================================================
     五、工具
     ============================================================ */

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }

  function storyById(id) {
    for (var i = 0; i < STORIES.length; i++) {
      if (STORIES[i].id === id) { return STORIES[i]; }
    }
    return null;
  }

  function catName(id) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].id === id) { return CATEGORIES[i].name; }
    }
    return '';
  }

  function sceneOf(id) {
    for (var i = 0; i < SCENES.length; i++) {
      if (SCENES[i].id === id) { return SCENES[i]; }
    }
    return SCENES[0];
  }

  function durationOf(story) { return story.minutes * 60; }

  function fmtTime(sec) {
    var s = Math.max(0, Math.round(sec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' + r : String(r));
  }

  function fmtMinutes(min) {
    if (min < 60) { return min + ' 分钟'; }
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? h + ' 小时 ' + m + ' 分钟' : h + ' 小时';
  }

  function monthsLabel(months) {
    return Math.floor(months / 12) + ' 岁 ' + (months % 12) + ' 个月';
  }

  function durBucket(minutes) {
    if (minutes <= 5) { return 'short'; }
    if (minutes <= 10) { return 'mid'; }
    return 'long';
  }

  function poolForHome() {
    if (state.parent.age === 'all') { return STORIES.slice(); }
    return STORIES.filter(function (s) { return s.age === state.parent.age; });
  }

  function tonightPick() {
    var pool = poolForHome();
    if (!pool.length) { pool = STORIES.slice(); }
    var day = new Date().getDate();
    return pool[day % pool.length];
  }

  function inProgress() {
    return STORIES.filter(function (s) {
      var p = state.progress[s.id] || 0;
      return p > 0 && p < durationOf(s);
    });
  }

  function isFav(id) { return state.favorites.indexOf(id) !== -1; }

  function favStories() {
    return STORIES.filter(function (s) { return isFav(s.id); });
  }

  function filterStories() {
    return STORIES.filter(function (s) {
      if (state.filter.age !== 'all' && s.age !== state.filter.age) { return false; }
      if (state.filter.dur !== 'all' && durBucket(s.minutes) !== state.filter.dur) { return false; }
      if (state.filter.cat !== 'all' && s.cat !== state.filter.cat) { return false; }
      return true;
    });
  }

  function hasFilter() {
    return state.filter.age !== 'all' || state.filter.dur !== 'all' || state.filter.cat !== 'all';
  }

  function countByCat(catId) {
    return STORIES.filter(function (s) { return s.cat === catId; }).length;
  }

  function nightAutoNow() {
    var h = new Date().getHours();
    return h >= 21 || h < 6;
  }

  function nightActive() {
    if (state.night.override === 'on') { return true; }
    if (state.night.override === 'off') { return false; }
    return state.night.auto && nightAutoNow();
  }

  function buildWeek() {
    var names = ['日', '一', '二', '三', '四', '五', '六'];
    var now = new Date();
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      var p = WEEK_PATTERN[6 - i];
      out.push({
        label: names[d.getDay()],
        date: (d.getMonth() + 1) + '/' + d.getDate(),
        minutes: p.m,
        ids: p.ids,
        today: i === 0
      });
    }
    return out;
  }

  /* ============================================================
     六、渲染
     ============================================================ */

  function renderSplash() {
    els.splashMark.innerHTML = splashArt();
  }

  function renderStaticIcons() {
    els.storyBackIcon.innerHTML = icon('back', 'od-icon--btn');
    els.playerBackIcon.innerHTML = icon('back', 'od-icon--btn');
    els.playerNightIcon.innerHTML = icon('moon', 'od-icon--btn');
    els.playerBack15Icon.innerHTML = icon('back15', 'od-icon--btn');
    els.playerFwd15Icon.innerHTML = icon('fwd15', 'od-icon--btn');
    els.nightBackIcon.innerHTML = icon('back', 'od-icon--btn');
    els.nightDayIcon.innerHTML = icon('sun', 'od-icon--btn');
    els.mineShieldIcon.innerHTML = icon('shield', 'od-icon--btn');
    els.mineMoonIcon.innerHTML = icon('moon', 'od-icon--btn');
    els.mineNightscreenIcon.innerHTML = icon('clock', 'od-icon--btn');
    els.mineChevIcon.innerHTML = icon('chev');
    els.mineChev2Icon.innerHTML = icon('chev');
    els.gateBackIcon.innerHTML = icon('back', 'od-icon--btn');
    els.gateErrorIcon.innerHTML = icon('alert');
    els.parentBackIcon.innerHTML = icon('back', 'od-icon--btn');
    els.tabHomeIcon.innerHTML = icon('home', 'od-icon--nav');
    els.tabCategoryIcon.innerHTML = icon('grid', 'od-icon--nav');
    els.tabMineIcon.innerHTML = icon('user', 'od-icon--nav');
    els.homeCatMoreIcon.innerHTML = icon('chev');
    els.profileNameErrorIcon.innerHTML = icon('alert');
  }

  function renderHome() {
    var tonight = tonightPick();
    els.homeHeroArt.innerHTML = coverArt(tonight);
    els.homeHeroTitle.textContent = '《' + tonight.title + '》';
    els.homeHeroMeta.textContent = AGE_LABEL[tonight.age] + ' · ' + tonight.minutes + ' 分钟';
    els.homeHeroWhy.textContent = tonight.why;
    els.homeHeroBtn.dataset.id = tonight.id;

    /* 继续听 */
    var prog = inProgress();
    if (prog.length) {
      var s = prog[0];
      var pos = state.progress[s.id] || 0;
      var dur = durationOf(s);
      els.homeContinue.hidden = false;
      els.homeContinueBody.innerHTML =
        '<div class="continue-card">' +
          '<div class="continue-card__art">' + coverArt(s) + '</div>' +
          '<div class="continue-card__body">' +
            '<p class="continue-card__title">《' + esc(s.title) + '》</p>' +
            '<span class="progress-line"><span id="home-continue-fill" style="width:' + (dur ? (pos / dur * 100).toFixed(1) : 0) + '%"></span></span>' +
            '<p class="continue-card__meta od-nowrap" id="home-continue-meta">已听 ' + fmtTime(pos) + ' / ' + fmtTime(dur) + '</p>' +
          '</div>' +
          '<button class="iconbtn" type="button" data-action="play" data-id="' + s.id + '" aria-label="继续听《' + esc(s.title) + '》">' + icon('play', 'od-icon--btn') + '</button>' +
        '</div>';
    } else {
      els.homeContinue.hidden = true;
      els.homeContinueBody.innerHTML = '';
    }

    /* 场景 */
    els.homeScenes.innerHTML = SCENES.map(function (sc) {
      return '<button class="scene" type="button" data-action="scene" data-scene="' + sc.id + '"' +
        ' aria-pressed="' + (state.scene === sc.id ? 'true' : 'false') + '">' +
        '<span aria-hidden="true">' + icon(sc.icon, 'od-icon--lg') + '</span>' +
        '<span class="scene__label">' + esc(sc.name) + '</span>' +
        '</button>';
    }).join('');
    var scene = sceneOf(state.scene);
    els.homeSceneHint.textContent = scene.hint;

    /* 场景推荐 */
    var list = poolForHome().filter(function (s) { return s.scene === state.scene; });
    state.lastList = list.map(function (s) { return s.id; });
    if (!list.length) {
      els.homeSceneList.innerHTML = '<div class="empty" style="width:100%">' +
        '<span class="empty__title">这个场景还没有故事</span>' +
        '<span class="empty__hint">换一个场景，或者到分类里挑一挑。</span></div>';
    } else {
      els.homeSceneList.innerHTML = list.map(storyCard).join('');
    }

    /* 推荐分类 */
    var cats = CATEGORIES.slice().sort(function (a, b) { return countByCat(b.id) - countByCat(a.id); }).slice(0, 4);
    els.homeCats.innerHTML = cats.map(catTile).join('');

    /* 夜间提示 */
    if (nightActive()) {
      els.homeNightNotice.hidden = false;
      els.homeNightNotice.textContent = '已进入夜间模式：画面已调暗，21:00–6:00 自动开启。';
    } else {
      els.homeNightNotice.hidden = true;
      els.homeNightNotice.textContent = '';
    }
  }

  function storyCard(s) {
    return '<button class="story-card" type="button" data-action="story" data-id="' + s.id + '">' +
      '<span class="story-card__art">' + coverArt(s) + '</span>' +
      '<span class="story-card__title od-keep">《' + esc(s.title) + '》</span>' +
      '<span class="story-card__meta od-nowrap">' + AGE_LABEL[s.age] + ' · ' + s.minutes + ' 分</span>' +
      '</button>';
  }

  function tileOf(s) {
    return '<button class="tile" type="button" data-action="story" data-id="' + s.id + '">' +
      '<span class="tile__art">' + coverArt(s) + '</span>' +
      '<span class="tile__title od-keep">《' + esc(s.title) + '》</span>' +
      '<span class="tile__meta od-nowrap">' + AGE_LABEL[s.age] + ' · ' + s.minutes + ' 分钟</span>' +
      '</button>';
  }

  function catTile(c) {
    return '<button class="cat-tile" type="button" data-action="cat" data-cat="' + c.id + '"' +
      ' aria-pressed="' + (state.filter.cat === c.id ? 'true' : 'false') + '">' +
      '<span aria-hidden="true">' + icon(c.icon, 'od-icon--lg') + '</span>' +
      '<span><span class="cat-tile__name">' + esc(c.name) + '</span>' +
      '<span class="cat-tile__count od-nowrap">' + countByCat(c.id) + ' 个故事</span></span>' +
      '</button>';
  }

  function renderCategory() {
    var list = filterStories();
    els.categoryCount.textContent = '共 ' + list.length + ' 个故事';

    var ages = [{ id: 'all', label: '全部' }].concat(
      Object.keys(AGE_LABEL).map(function (k) { return { id: k, label: AGE_LABEL[k] }; })
    );
    els.filterAge.innerHTML = ages.map(function (a) {
      return '<button class="chip" type="button" data-action="f-age" data-age="' + a.id + '"' +
        ' aria-pressed="' + (state.filter.age === a.id ? 'true' : 'false') + '">' + esc(a.label) + '</button>';
    }).join('');

    els.filterDur.innerHTML = DUR_FILTERS.map(function (d) {
      return '<button class="chip" type="button" data-action="f-dur" data-dur="' + d.id + '"' +
        ' aria-pressed="' + (state.filter.dur === d.id ? 'true' : 'false') + '">' + esc(d.label) + '</button>';
    }).join('');

    els.filterCat.innerHTML = CATEGORIES.map(catTile).join('');

    els.categoryClear.hidden = !hasFilter();

    if (!list.length) {
      els.categoryList.innerHTML = '<div class="empty" style="grid-column:1 / -1">' +
        '<span class="empty__title">这个筛选下还没有故事</span>' +
        '<span class="empty__hint">把年龄档或时长放宽一些，就能看到更多。</span>' +
        '<button class="btn btn--ghost" type="button" data-action="clear-filters">清除筛选</button>' +
        '</div>';
    } else {
      els.categoryList.innerHTML = list.map(tileOf).join('');
    }
    if (state.route === 'category') {
      state.lastList = list.map(function (s) { return s.id; });
    }
  }

  function renderStory() {
    var s = storyById(state.storyId);
    if (!s) {
      els.storyBody.innerHTML = '<div class="empty"><span class="empty__title">还没有选择故事</span>' +
        '<span class="empty__hint">回到首页或分类页，挑一个想听的故事。</span>' +
        '<button class="btn btn--ghost" type="button" data-action="go" data-route="home">回首页</button></div>';
      els.storyActions.hidden = true;
      return;
    }
    els.storyActions.hidden = false;
    var pos = state.progress[s.id] || 0;
    els.storyBody.innerHTML =
      '<div class="detail__hero"><div class="detail__art">' + coverArt(s) + '</div></div>' +
      '<h2 class="detail__title">《' + esc(s.title) + '》</h2>' +
      '<div class="detail__tags">' +
        '<span class="tag od-nowrap">' + AGE_LABEL[s.age] + '</span>' +
        '<span class="tag od-nowrap">' + s.minutes + ' 分钟</span>' +
        '<span class="tag tag--quiet">' + esc(catName(s.cat)) + '</span>' +
        '<span class="tag tag--quiet">' + esc(sceneOf(s.scene).name) + '场景</span>' +
      '</div>' +
      '<section class="detail__section">' +
        '<h3 class="detail__section-title">故事简介</h3>' +
        '<p class="detail__text">' + esc(s.intro) + '</p>' +
      '</section>' +
      '<section class="detail__section">' +
        '<h3 class="detail__section-title">收听信息</h3>' +
        '<p class="detail__fact">来源：' + esc(s.origin) + '</p>' +
        '<p class="detail__fact od-nowrap">时长：约 ' + s.minutes + ' 分钟</p>' +
        (pos ? '<p class="detail__fact od-nowrap">上次听到 ' + fmtTime(pos) + '，可以接着听。</p>' : '') +
      '</section>';

    var fav = isFav(s.id);
    els.storyFavBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
    els.storyFavIcon.innerHTML = icon(fav ? 'heartFill' : 'heart', 'od-icon--btn');
    els.storyFavLabel.textContent = fav ? '已收藏' : '收藏';
    els.storyPlayBtn.textContent = pos ? '继续听' : '开始听';
    els.storyPlayBtn.dataset.id = s.id;
  }

  function renderPlayerStatic() {
    var s = storyById(state.player.id);
    if (!s) { return; }
    els.playerArt.innerHTML = coverArt(s);
    els.nightArt.innerHTML = coverArt(s);
    els.playerTitle.textContent = '《' + s.title + '》';
    els.playerMeta.textContent = AGE_LABEL[s.age] + ' · ' + s.minutes + ' 分钟 · ' + catName(s.cat);
    els.nightTitle.textContent = '《' + s.title + '》';
    els.nightMeta.textContent = AGE_LABEL[s.age] + ' · ' + s.minutes + ' 分钟';
    els.playerRange.max = durationOf(s);
    els.nightRange.max = durationOf(s);
  }

  function updatePlayerLive() {
    var s = storyById(state.player.id);
    if (!s) { return; }
    var dur = durationOf(s);
    var pos = Math.min(state.player.pos, dur);
    var pct = dur ? (pos / dur * 100) : 0;
    var playing = state.player.playing;

    [[els.playerRange, els.playerElapsed, els.playerTotal],
     [els.nightRange, els.nightElapsed, els.nightTotal]].forEach(function (trio) {
      var range = trio[0];
      if (!range) { return; }
      if (document.activeElement !== range) { range.value = pos; }
      range.style.setProperty('--fill', pct.toFixed(2) + '%');
      trio[1].textContent = fmtTime(pos);
      trio[2].textContent = fmtTime(dur);
    });

    if (state.nowPlaying !== playing) {
      state.nowPlaying = playing;
      var playIcon = icon(playing ? 'pause' : 'play', 'od-icon--play');
      els.playerPlayIcon.innerHTML = playIcon;
      els.nightPlayIcon.innerHTML = playIcon;
      els.nowbarPlayIcon.innerHTML = icon(playing ? 'pause' : 'play');
      els.playerPlayBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
      els.nightPlayBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    }

    var note = timerNote();
    els.playerTimerNote.textContent = note;
    els.nightTimerNote.textContent = note;
    updateTimerChipsPressed();

    if (state.nowFav !== s.id + ':' + isFav(s.id)) {
      state.nowFav = s.id + ':' + isFav(s.id);
      var fav = isFav(s.id);
      els.playerFavBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
      els.playerFavIcon.innerHTML = icon(fav ? 'heartFill' : 'heart', 'od-icon--btn');
      els.playerFavLabel.textContent = fav ? '已收藏' : '收藏';
    }

    els.playerAutonext.checked = state.player.autoNext;

    /* 底部正在播放条 */
    if (state.nowId !== s.id) {
      state.nowId = s.id;
      els.nowbarArt.innerHTML = coverArt(s);
      els.nowbarTitle.textContent = '《' + s.title + '》';
    }
    els.nowbarMeta.textContent = fmtTime(pos) + ' / ' + fmtTime(dur) + ' · ' + (playing ? '正在播放' : '已暂停');
    els.nowbarFill.style.width = pct.toFixed(2) + '%';

    /* 首页继续听进度 */
    var fill = $('home-continue-fill');
    var meta = $('home-continue-meta');
    if (fill && meta && state.player.id === s.id) {
      fill.style.width = pct.toFixed(2) + '%';
      meta.textContent = '已听 ' + fmtTime(pos) + ' / ' + fmtTime(dur);
    }
  }

  function renderTimerChips() {
    els.playerTimerChips.innerHTML = TIMER_OPTIONS.map(function (t) {
      return '<button class="chip chip--kid" type="button" data-action="timer" data-timer="' + t.value + '"' +
        ' aria-pressed="' + (state.player.sleepMode === t.value ? 'true' : 'false') + '">' + esc(t.label) + '</button>';
    }).join('');
  }

  function updateTimerChipsPressed() {
    var buttons = els.playerTimerChips.querySelectorAll('[data-timer]');
    Array.prototype.forEach.call(buttons, function (btn) {
      if (btn.dataset.timer === state.player.sleepMode) {
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function timerNote() {
    var p = state.player;
    if (p.sleepMode === 'end') { return '听完这一集后停止'; }
    if (p.sleepMode === 'off') { return '未开启'; }
    return '还有 ' + fmtTime(p.sleepLeft) + ' 停止';
  }

  function renderMine() {
    var p = state.profile;
    els.mineProfile.innerHTML =
      '<div class="profile__avatar" aria-hidden="true">' + esc(p.name.slice(0, 1) || '小') + '</div>' +
      '<div class="profile__body">' +
        '<p class="profile__name">' + esc(p.name) + '</p>' +
        '<p class="profile__meta od-nowrap">' + esc(monthsLabel(p.months)) + ' · ' + AGE_LABEL[p.age] + '档</p>' +
      '</div>' +
      '<button class="iconbtn" type="button" data-action="open-profile" aria-label="编辑儿童档案">' +
      icon('edit', 'od-icon--btn') + '</button>';

    /* 继续听 */
    var prog = inProgress();
    if (prog.length) {
      els.mineContinueList.innerHTML = prog.map(function (s) {
        var pos = state.progress[s.id] || 0;
        return miniRow(s, '已听 ' + fmtTime(pos) + ' / ' + fmtTime(durationOf(s)), 'play', '继续听');
      }).join('');
    } else {
      els.mineContinueList.innerHTML = emptyBox('还没有在听的故事', '从首页挑一个，听一会儿就会出现在这里。');
    }

    /* 收藏 */
    var favs = favStories();
    if (favs.length) {
      els.mineFavList.innerHTML = favs.map(function (s) {
        return miniRow(s, AGE_LABEL[s.age] + ' · ' + s.minutes + ' 分钟', 'story', '查看');
      }).join('');
    } else {
      els.mineFavList.innerHTML = emptyBox('收藏还是空的', '在故事详情或播放器里点一下爱心，就会收进来。');
    }

    /* 最近听过 */
    if (state.history.length) {
      els.mineHistoryList.innerHTML = state.history.map(function (h) {
        var s = storyById(h.id);
        if (!s) { return ''; }
        return miniRow(s, h.when, 'story', '查看');
      }).join('');
    } else {
      els.mineHistoryList.innerHTML = emptyBox('还没有收听记录', '听过的故事会按时间排在这里。');
    }

    els.mineNightAuto.checked = state.night.auto;
    els.mineNightHint.textContent = nightAutoNow()
      ? '现在是夜间时段，画面已调暗'
      : '21:00 后自动调暗画面';
    els.mineNightstateHint.textContent = nightActive() ? '当前是夜间画面' : '看看深夜里的样子';
  }

  function miniRow(s, meta, action, label) {
    var btn = action === 'play'
      ? '<button class="mini-row__action" type="button" data-action="play" data-id="' + s.id + '" aria-label="继续听《' + esc(s.title) + '》">' + icon('play') + '</button>'
      : '<button class="mini-row__action" type="button" data-action="story" data-id="' + s.id + '" aria-label="查看《' + esc(s.title) + '》">' + icon('chev') + '</button>';
    return '<div class="mini-row">' +
      '<span class="mini-row__art" aria-hidden="true">' + coverArt(s) + '</span>' +
      '<span class="mini-row__body">' +
        '<span class="mini-row__title od-keep">《' + esc(s.title) + '》</span>' +
        '<span class="mini-row__meta od-nowrap">' + esc(meta) + '</span>' +
      '</span>' + btn + '</div>';
  }

  function emptyBox(title, hint) {
    return '<div class="empty"><span class="empty__title">' + esc(title) + '</span>' +
      '<span class="empty__hint">' + esc(hint) + '</span></div>';
  }

  function renderGate() {
    var g = state.gate;
    if (!g.q) { return; }
    els.gateExpr.textContent = g.q.a + ' × ' + g.q.b + ' = ?';
    els.gateAnswer.textContent = g.answer ? g.answer : '—';
    els.gateAnswer.setAttribute('data-empty', g.answer ? 'false' : 'true');
    if (g.error) {
      els.gateError.hidden = false;
      els.gateErrorText.textContent = g.error;
    } else {
      els.gateError.hidden = true;
      els.gateErrorText.textContent = '';
    }
    var okKey = els.gateKeypad.querySelector('[data-key="ok"]');
    if (okKey) { okKey.disabled = g.answer.length === 0; }
  }

  function renderKeypad() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'ok'];
    els.gateKeypad.innerHTML = keys.map(function (k) {
      if (k === 'clear') {
        return '<button class="key key--wide" type="button" data-action="key" data-key="clear">清除</button>';
      }
      if (k === 'ok') {
        return '<button class="key key--wide key--confirm" type="button" data-action="key" data-key="ok">确定</button>';
      }
      return '<button class="key" type="button" data-action="key" data-key="' + k + '">' + k + '</button>';
    }).join('');
  }

  function newQuestion() {
    var pool = [[7, 8], [6, 7], [8, 9], [9, 6], [7, 6], [8, 4], [9, 7], [6, 8]];
    var pick = pool[Math.floor(Math.random() * pool.length)];
    var guard = 0;
    while (state.gate.q && pick[0] === state.gate.q.a && pick[1] === state.gate.q.b && guard < 8) {
      pick = pool[Math.floor(Math.random() * pool.length)];
      guard++;
    }
    state.gate.q = { a: pick[0], b: pick[1], answer: pick[0] * pick[1] };
    state.gate.answer = '';
    state.gate.error = '';
  }

  function renderParent() {
    var limits = [
      { value: '20', label: '20 分钟' },
      { value: '30', label: '30 分钟' },
      { value: '45', label: '45 分钟' },
      { value: 'none', label: '不限' }
    ];
    els.parentLimits.innerHTML = limits.map(function (l) {
      return '<button class="seg" type="button" data-action="limit" data-limit="' + l.value + '"' +
        ' aria-pressed="' + (String(state.parent.limit) === l.value ? 'true' : 'false') + '">' + esc(l.label) + '</button>';
    }).join('');
    els.parentLimitHint.textContent = state.parent.limit === 'none'
      ? '不限制时长'
      : '超过 ' + state.parent.limit + ' 分钟会自动暂停';

    var ages = [
      { id: '3-6', label: '3–6 岁' },
      { id: '6-9', label: '6–9 岁' },
      { id: '9+', label: '9+ 岁' },
      { id: 'all', label: '全部' }
    ];
    els.parentAges.innerHTML = ages.map(function (a) {
      return '<button class="seg" type="button" data-action="p-age" data-age="' + a.id + '"' +
        ' aria-pressed="' + (state.parent.age === a.id ? 'true' : 'false') + '">' + esc(a.label) + '</button>';
    }).join('');
    els.parentAgeHint.textContent = state.parent.age === 'all'
      ? '首页与分类显示全部年龄档'
      : '首页只显示 ' + AGE_LABEL[state.parent.age] + ' 的故事';

    renderReport();
  }

  function renderReport() {
    var week = buildWeek();
    var totalMin = 0;
    var totalCount = 0;
    var max = 1;
    week.forEach(function (d) {
      totalMin += d.minutes;
      totalCount += d.ids.length;
      if (d.minutes > max) { max = d.minutes; }
    });

    if (totalCount === 0 || totalMin === 0) {
      els.parentReport.innerHTML = emptyBox('本周还没有播放记录', '孩子听过故事之后，这里会显示每天听了多久。');
      return;
    }

    var bars = week.map(function (d) {
      var h = d.minutes ? Math.max(14, Math.round(d.minutes / max * 96)) : 3;
      var cls = 'report__bar' + (d.minutes ? (d.today ? ' report__bar--today' : '') : ' report__bar--zero');
      return '<div class="report__col">' +
        '<span class="' + cls + ' od-fixed" style="height:' + h + 'px"></span>' +
        '<span class="report__day' + (d.today ? ' report__day--today' : '') + '">' + esc(d.label) + '</span>' +
        '</div>';
    }).join('');

    var aria = '本周每天收听时长：' + week.map(function (d) {
      return '周' + d.label + ' ' + d.minutes + ' 分钟';
    }).join('，') + '。合计 ' + fmtMinutes(totalMin) + '，' + totalCount + ' 个故事。';

    var counts = {};
    week.forEach(function (d) {
      d.ids.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    });
    var listRows = Object.keys(counts).map(function (id) {
      var s = storyById(id);
      if (!s) { return ''; }
      return miniRow(s, '本周听过 ' + counts[id] + ' 次', 'story', '查看');
    }).join('');

    els.parentReport.innerHTML =
      '<div class="report__totals">' +
        '<div class="report__stat">' +
          '<span class="report__stat-value od-nowrap">' + totalCount + ' 个</span>' +
          '<span class="report__stat-label">本周故事</span>' +
        '</div>' +
        '<div class="report__stat">' +
          '<span class="report__stat-value od-nowrap">' + fmtMinutes(totalMin) + '</span>' +
          '<span class="report__stat-label">本周时长</span>' +
        '</div>' +
      '</div>' +
      '<div class="report__chart" role="img" aria-label="' + esc(aria) + '">' + bars + '</div>' +
      '<div class="report__axis"><span>单位：分钟</span><span class="od-nowrap">峰值 ' + max + ' 分钟</span></div>' +
      (listRows ? '<div class="report__list">' + listRows + '</div>' : '');
  }

  function renderDock() {
    var tabRoutes = { home: 1, category: 1, mine: 1 };
    var isTab = !!tabRoutes[state.route];
    var show = isTab && state.started;

    els.dock.hidden = !isTab;
    els.nowbar.hidden = !show;
    els.app.classList.toggle('app--docked', isTab && !show);
    els.app.classList.toggle('app--docked-now', show);

    Array.prototype.forEach.call(els.tabbar.querySelectorAll('.tab'), function (btn) {
      if (btn.dataset.route === state.route) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.removeAttribute('aria-current');
      }
    });
  }

  function applyNight() {
    var on = nightActive();
    els.app.classList.toggle('is-night', on);
    var screen = document.querySelector('[data-phone-screen]');
    if (screen) {
      screen.style.setProperty('--phone-screen-bg', on ? '#1E1B2E' : '#FBF7F0');
      screen.style.setProperty('--phone-system-fg', on ? '#F5F0E6' : '#17181a');
    }
    els.nightNote.textContent = nightAutoNow()
      ? '现在是夜间时段（21:00–6:00），画面已自动调暗，功能只留最必要的几个。'
      : '这是夜间模式的样子：正式使用时会从 21:00 自动开启。';
  }

  function renderAll() {
    renderHome();
    renderCategory();
    renderStory();
    renderMine();
    renderParent();
    renderGate();
    renderPlayerStatic();
    updatePlayerLive();
    renderDock();
  }

  /* ============================================================
     七、路由
     ============================================================ */

  var ROUTES = {
    launch: { screen: 'screen-launch' },
    home: { screen: 'screen-home' },
    category: { screen: 'screen-category' },
    story: { screen: 'screen-story' },
    player: { screen: 'screen-player' },
    mine: { screen: 'screen-mine' },
    gate: { screen: 'screen-gate' },
    parent: { screen: 'screen-parent' },
    night: { screen: 'screen-night' }
  };

  function hashFor(route, param) {
    return '#/' + route + (param ? '/' + param : '');
  }

  function parseHash() {
    var raw = String(window.location.hash || '').replace(/^#\/?/, '');
    if (!raw) { return null; }
    var parts = raw.split('/');
    var route = parts[0];
    if (!ROUTES[route]) { return null; }
    return { route: route, param: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function applyRoute(route, param, options) {
    var opts = options || {};
    if (!ROUTES[route]) { route = 'home'; }
    if (!opts.keepScroll) {
      scrollMemo[state.route] = els.content.scrollTop;
    }
    state.route = route;

    if (route === 'story') {
      if (param && storyById(param)) { state.storyId = param; }
      if (!state.storyId) { state.storyId = tonightPick().id; }
    }
    if (route === 'gate' && !state.gate.q) { newQuestion(); }
    if (route === 'night' && state.night.override !== 'on') { state.night.override = 'on'; }
    if (route === 'player' && state.night.override === null && nightAutoNow() && state.night.auto) {
      route = 'night';
      state.route = 'night';
    }

    applyNight();
    renderAll();

    Object.keys(ROUTES).forEach(function (key) {
      var el = $(ROUTES[key].screen);
      if (el) { el.hidden = key !== state.route; }
    });

    els.content.scrollTop = opts.keepScroll ? els.content.scrollTop : (scrollMemo[state.route] || 0);

    if (!opts.fromHash) {
      suppressHash = true;
      try {
        var next = hashFor(state.route, state.route === 'story' ? state.storyId : null);
        if (window.location.hash !== next) { window.location.hash = next; }
      } catch (err) { /* 沙箱里禁止改 hash 时不影响切换 */ }
      window.setTimeout(function () { suppressHash = false; }, 0);
    }

    var heading = $(ROUTES[state.route].screen).querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: true }); } catch (err) { heading.focus(); }
    }
  }

  function go(route, param) {
    if (state.route !== route) {
      state.stack.push({ route: state.route, param: state.storyId });
      if (state.stack.length > 12) { state.stack.shift(); }
    }
    applyRoute(route, param);
  }

  function back() {
    var prev = state.stack.pop();
    if (!prev) { applyRoute('home', null); return; }
    applyRoute(prev.route, prev.param, { keepScroll: true });
  }

  /* ============================================================
     八、播放器
     ============================================================ */

  function currentList() {
    if (state.queue.length) { return state.queue; }
    return STORIES.map(function (s) { return s.id; });
  }

  function startStory(id) {
    var s = storyById(id);
    if (!s) { return; }
    state.player.id = s.id;
    state.player.pos = state.progress[s.id] || 0;
    if (state.player.pos >= durationOf(s)) { state.player.pos = 0; }
    state.player.playing = true;
    state.player.sleepMode = 'off';
    state.player.sleepLeft = 0;
    state.started = true;
    state.queue = state.lastList.length ? state.lastList.slice() : STORIES.map(function (x) { return x.id; });
    if (state.queue.indexOf(s.id) === -1) { state.queue.unshift(s.id); }
    state.history = [{ id: s.id, when: '刚刚' }].concat(
      state.history.filter(function (h) { return h.id !== s.id; })
    ).slice(0, 6);
    renderAll();
    go(routeForPlayback());
    ensureTicker();
    toast('开始播放《' + s.title + '》');
  }

  function routeForPlayback() {
    return (state.night.override === 'on' || (state.night.auto && nightAutoNow())) ? 'night' : 'player';
  }

  function togglePlay() {
    var s = storyById(state.player.id);
    if (!s) { return; }
    state.player.playing = !state.player.playing;
    if (state.player.playing) {
      state.started = true;
      state.history = [{ id: s.id, when: '刚刚' }].concat(
        state.history.filter(function (h) { return h.id !== s.id; })
      ).slice(0, 6);
      ensureTicker();
      toast('继续播放');
    } else {
      state.progress[s.id] = state.player.pos;
      stopTicker();
      toast('已暂停');
    }
    renderAll();
  }

  function seek(delta) {
    var s = storyById(state.player.id);
    if (!s) { return; }
    state.player.pos = Math.max(0, Math.min(durationOf(s), state.player.pos + delta));
    state.progress[s.id] = state.player.pos;
    updatePlayerLive();
  }

  function seekTo(value) {
    var s = storyById(state.player.id);
    if (!s) { return; }
    state.player.pos = Math.max(0, Math.min(durationOf(s), Number(value) || 0));
    state.progress[s.id] = state.player.pos;
    updatePlayerLive();
  }

  function setTimer(mode) {
    var p = state.player;
    if (mode === 'off') {
      p.sleepMode = 'off';
      p.sleepLeft = 0;
      toast('已关闭定时');
    } else if (mode === 'end') {
      p.sleepMode = 'end';
      p.sleepLeft = 0;
      toast('这一集听完就停');
    } else {
      p.sleepMode = mode;
      p.sleepLeft = Number(mode) * 60;
      toast(mode + ' 分钟后自动停止');
    }
    ensureTicker();
    updatePlayerLive();
  }

  function ensureTicker() {
    if (state.timer) { return; }
    state.timer = window.setInterval(tick, 1000);
  }

  function stopTicker() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  }

  function tick() {
    var p = state.player;
    var s = storyById(p.id);
    if (!s) { stopTicker(); return; }
    if (!p.playing) { return; }

    var dur = durationOf(s);
    p.pos += 1;

    if (p.sleepMode !== 'off' && p.sleepMode !== 'end') {
      p.sleepLeft -= 1;
      if (p.sleepLeft <= 0) {
        p.sleepMode = 'off';
        p.sleepLeft = 0;
        p.playing = false;
        state.progress[s.id] = p.pos;
        stopTicker();
        renderAll();
        toast('定时结束，故事已暂停');
        return;
      }
    }

    if (p.pos >= dur) {
      p.pos = dur;
      var stopHere = p.sleepMode === 'end' || !p.autoNext;
      var list = currentList();
      var idx = list.indexOf(s.id);
      var next = (!stopHere && idx !== -1 && idx < list.length - 1) ? list[idx + 1] : null;
      if (next) {
        state.progress[s.id] = 0;
        p.id = next;
        p.pos = 0;
        renderAll();
        toast('自动播放下一集');
      } else {
        p.playing = false;
        p.sleepMode = 'off';
        state.progress[s.id] = 0;
        stopTicker();
        renderAll();
        toast(stopHere ? '这一集听完了，已暂停' : '已经是最后一个故事了');
      }
      return;
    }

    state.progress[s.id] = p.pos;
    updatePlayerLive();
  }

  /* ============================================================
     九、家长门
     ============================================================ */

  function gateKey(key) {
    var g = state.gate;
    if (key === 'clear') {
      g.answer = '';
      g.error = '';
      renderGate();
      return;
    }
    if (key === 'ok') { submitGate(); return; }
    if (/^[0-9]$/.test(key) && g.answer.length < 3) {
      g.answer += key;
      g.error = '';
      renderGate();
    }
  }

  function submitGate() {
    var g = state.gate;
    if (!g.answer) {
      g.error = '请先输入答案，再点确定。';
      renderGate();
      return;
    }
    if (Number(g.answer) === g.q.answer) {
      g.answer = '';
      g.error = '';
      newQuestion();
      renderGate();
      go('parent');
      toast('验证通过，已进入家长中心');
    } else {
      newQuestion();
      g.error = '答案不对。换了一道题，再试一次。';
      renderGate();
    }
  }

  /* ============================================================
     十、弹窗与提示
     ============================================================ */

  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    els.toast.style.animation = 'none';
    void els.toast.offsetWidth;
    els.toast.style.animation = '';
    if (state.toastTimer) { window.clearTimeout(state.toastTimer); }
    state.toastTimer = window.setTimeout(function () {
      els.toast.hidden = true;
    }, 2400);
  }

  function openDialog(dialog) {
    if (!dialog || dialog.open) { return; }
    if (typeof dialog.showModal === 'function') { dialog.showModal(); }
    else { dialog.setAttribute('open', ''); }
  }

  function closeDialog(dialog) {
    if (!dialog) { return; }
    if (typeof dialog.close === 'function' && dialog.open) { dialog.close(); }
    else { dialog.removeAttribute('open'); }
  }

  function openProfile() {
    els.profileName.value = state.profile.name;
    els.profileAge.value = state.profile.age;
    hideNameError();
    openDialog(els.profileDialog);
    window.setTimeout(function () {
      try { els.profileName.focus(); } catch (err) { /* 忽略 */ }
    }, 80);
  }

  function hideNameError() {
    els.profileNameError.hidden = true;
    els.profileNameErrorText.textContent = '';
    els.profileName.removeAttribute('aria-invalid');
  }

  function showNameError(message) {
    els.profileNameError.hidden = false;
    els.profileNameErrorText.textContent = message;
    els.profileName.setAttribute('aria-invalid', 'true');
  }

  function saveProfile() {
    var name = els.profileName.value.trim();
    if (!name) {
      showNameError('请填写孩子昵称，家长中心会用这个称呼。');
      els.profileName.focus();
      return;
    }
    if (name.length > 8) {
      showNameError('昵称最多 8 个字，现在有 ' + name.length + ' 个。');
      els.profileName.focus();
      return;
    }
    state.profile.name = name;
    state.profile.age = els.profileAge.value;
    hideNameError();
    closeDialog(els.profileDialog);
    renderMine();
    toast('儿童档案已更新');
  }

  /* ============================================================
     十一、事件
     ============================================================ */

  var ACTIONS = {
    'go': function (el) { go(el.dataset.route); },
    'tab': function (el) {
      if (el.dataset.route === state.route) {
        els.content.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      go(el.dataset.route);
    },
    'back': function () { back(); },
    'story': function (el) { go('story', el.dataset.id); },
    'play': function (el) { startStory(el.dataset.id); },
    'play-story': function (el) { startStory(el.dataset.id || state.storyId); },
    'start-tonight': function (el) { startStory(el.dataset.id || tonightPick().id); },
    'toggle-play': function () { togglePlay(); },
    'seek-back': function () { seek(-15); },
    'seek-fwd': function () { seek(15); },
    'toggle-fav': function (el) {
      var id = el.dataset.id || state.player.id;
      if (state.route === 'story' && state.storyId) { id = state.storyId; }
      var s = storyById(id);
      if (!s) { return; }
      var i = state.favorites.indexOf(id);
      if (i === -1) {
        state.favorites.push(id);
        toast('已收藏《' + s.title + '》');
      } else {
        state.favorites.splice(i, 1);
        toast('已取消收藏');
      }
      renderAll();
    },
    'scene': function (el) {
      state.scene = el.dataset.scene;
      renderHome();
    },
    'cat': function (el) {
      state.filter.cat = state.filter.cat === el.dataset.cat ? 'all' : el.dataset.cat;
      go('category');
    },
    'f-age': function (el) {
      state.filter.age = el.dataset.age;
      renderCategory();
    },
    'f-dur': function (el) {
      state.filter.dur = el.dataset.dur;
      renderCategory();
    },
    'clear-filters': function () {
      state.filter = { age: 'all', dur: 'all', cat: 'all' };
      renderCategory();
      renderHome();
      toast('已清除筛选');
    },
    'timer': function (el) { setTimer(el.dataset.timer); },
    'key': function (el) { gateKey(el.dataset.key); },
    'limit': function (el) {
      state.parent.limit = el.dataset.limit === 'none' ? 'none' : Number(el.dataset.limit);
      renderParent();
      toast(state.parent.limit === 'none' ? '已设为不限制时长' : '每日上限 ' + state.parent.limit + ' 分钟');
    },
    'p-age': function (el) {
      state.parent.age = el.dataset.age;
      renderParent();
      renderHome();
      toast(state.parent.age === 'all' ? '内容年龄档：全部' : '内容年龄档：' + AGE_LABEL[state.parent.age]);
    },
    'go-gate': function () { go('gate'); },
    'go-night': function () { go('night'); },
    'to-night': function () {
      state.night.override = 'on';
      applyNight();
      go('night');
      toast('已切换到夜间模式');
    },
    'to-day': function () {
      state.night.override = 'off';
      applyNight();
      go('player');
      toast('已回到日间画面');
    },
    'sleep-end': function () { setTimer('end'); },
    'sleep-off': function () { setTimer('off'); },
    'open-player': function () { go(routeForPlayback()); },
    'open-profile': function () { openProfile(); },
    'ask-exit': function () { openDialog(els.exitDialog); },
    'close-dialog': function (el) {
      var dlg = el.closest('dialog');
      closeDialog(dlg || els.profileDialog);
    },
    'save-profile': function () { saveProfile(); },
    'confirm-exit': function () {
      closeDialog(els.exitDialog);
      state.gate.answer = '';
      state.gate.error = '';
      newQuestion();
      renderGate();
      go('home');
      toast('已退出儿童模式');
    }
  };

  function bindEvents() {
    document.addEventListener('click', function (event) {
      var el = event.target.closest('[data-action]');
      if (!el || el.disabled) { return; }
      var action = el.dataset.action;
      if (!ACTIONS[action]) { return; }
      event.preventDefault();
      ACTIONS[action](el);
    });

    els.playerRange.addEventListener('input', function () { seekTo(this.value); });
    els.nightRange.addEventListener('input', function () { seekTo(this.value); });

    els.playerAutonext.addEventListener('change', function () {
      state.player.autoNext = this.checked;
      toast(this.checked ? '播完自动播下一集' : '播完停止');
    });

    els.mineNightAuto.addEventListener('change', function () {
      state.night.auto = this.checked;
      state.night.override = null;
      applyNight();
      renderHome();
      renderMine();
      toast(this.checked ? '21:00 后自动进入夜间模式' : '已关闭自动夜间模式');
    });

    /* 夜间模式整行都可以点：开关本体只有 56×32，整行点按更好按 */
    var nightRow = els.mineNightAuto.closest('.rowbtn');
    if (nightRow) {
      nightRow.addEventListener('click', function (event) {
        if (event.target === els.mineNightAuto) { return; }
        els.mineNightAuto.checked = !els.mineNightAuto.checked;
        els.mineNightAuto.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    els.profileName.addEventListener('blur', function () {
      var name = this.value.trim();
      if (!name) { showNameError('请填写孩子昵称。'); }
      else if (name.length > 8) { showNameError('昵称最多 8 个字。'); }
      else { hideNameError(); }
    });
    els.profileName.addEventListener('input', function () {
      if (this.value.trim()) { hideNameError(); }
    });

    window.addEventListener('hashchange', function () {
      if (suppressHash) { return; }
      var parsed = parseHash();
      if (!parsed) { return; }
      var current = hashFor(state.route, state.route === 'story' ? state.storyId : null);
      if (hashFor(parsed.route, parsed.param) === current) { return; }
      applyRoute(parsed.route, parsed.param, { fromHash: true });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') { return; }
      if (els.profileDialog.open || els.exitDialog.open) { return; }
      if (state.route === 'player' || state.route === 'night' || state.route === 'story' || state.route === 'parent' || state.route === 'gate') {
        back();
      }
    });
  }

  /* ============================================================
     十二、启动
     ============================================================ */

  function cacheElements() {
    els.app = $('app');
    els.content = document.querySelector('[data-phone-content]');
    els.dock = $('dock');
    els.nowbar = $('nowbar');
    els.nowbarArt = $('nowbar-art');
    els.nowbarTitle = $('nowbar-title');
    els.nowbarMeta = $('nowbar-meta');
    els.nowbarPlayIcon = $('nowbar-play-icon');
    els.nowbarFill = $('nowbar-fill');
    els.tabbar = $('tabbar');
    els.tabHomeIcon = $('tab-home-icon');
    els.tabCategoryIcon = $('tab-category-icon');
    els.tabMineIcon = $('tab-mine-icon');
    els.toast = $('toast');
    els.statusTime = $('status-time');

    els.splashMark = $('splash-mark');
    els.homeNightNotice = $('home-night-notice');
    els.homeHeroArt = $('home-hero-art');
    els.homeHeroTitle = $('home-hero-title');
    els.homeHeroMeta = $('home-hero-meta');
    els.homeHeroWhy = $('home-hero-why');
    els.homeHeroBtn = $('home-hero-btn');
    els.homeContinue = $('home-continue');
    els.homeContinueBody = $('home-continue-body');
    els.homeSceneHint = $('home-scene-hint');
    els.homeScenes = $('home-scenes');
    els.homeSceneList = $('home-scene-list');
    els.homeCats = $('home-cats');
    els.homeCatMoreIcon = $('home-cat-more-icon');

    els.categoryCount = $('category-count');
    els.filterAge = $('filter-age');
    els.filterDur = $('filter-dur');
    els.filterCat = $('filter-cat');
    els.categoryClear = $('category-clear');
    els.categoryList = $('category-list');

    els.storyBody = $('story-body');
    els.storyActions = $('story-actions');
    els.storyFavBtn = $('story-fav-btn');
    els.storyFavIcon = $('story-fav-icon');
    els.storyFavLabel = $('story-fav-label');
    els.storyPlayBtn = $('story-play-btn');
    els.storyBackIcon = $('story-back-icon');

    els.playerArt = $('player-art');
    els.playerTitle = $('player-title');
    els.playerMeta = $('player-meta');
    els.playerRange = $('player-range');
    els.playerElapsed = $('player-elapsed');
    els.playerTotal = $('player-total');
    els.playerPlayBtn = $('player-play-btn');
    els.playerPlayIcon = $('player-play-icon');
    els.playerFavBtn = $('player-fav-btn');
    els.playerFavIcon = $('player-fav-icon');
    els.playerFavLabel = $('player-fav-label');
    els.playerAutonext = $('player-autonext');
    els.playerTimerNote = $('player-timer-note');
    els.playerTimerChips = $('player-timer-chips');
    els.playerBackIcon = $('player-back-icon');
    els.playerNightIcon = $('player-night-icon');
    els.playerBack15Icon = $('player-back15-icon');
    els.playerFwd15Icon = $('player-fwd15-icon');

    els.mineProfile = $('mine-profile');
    els.mineContinueList = $('mine-continue-list');
    els.mineFavList = $('mine-fav-list');
    els.mineHistoryList = $('mine-history-list');
    els.mineShieldIcon = $('mine-shield-icon');
    els.mineChevIcon = $('mine-chev-icon');
    els.mineChev2Icon = $('mine-chev2-icon');
    els.mineMoonIcon = $('mine-moon-icon');
    els.mineNightscreenIcon = $('mine-nightscreen-icon');
    els.mineNightHint = $('mine-night-hint');
    els.mineNightstateHint = $('mine-nightstate-hint');
    els.mineNightAuto = $('mine-night-auto');
    els.mineNightAuto.setAttribute('aria-label', '夜间模式 21:00 后自动开启');

    els.gateExpr = $('gate-expr');
    els.gateAnswer = $('gate-answer');
    els.gateError = $('gate-error');
    els.gateErrorIcon = $('gate-error-icon');
    els.gateErrorText = $('gate-error-text');
    els.gateKeypad = $('gate-keypad');
    els.gateBackIcon = $('gate-back-icon');

    els.parentLimits = $('parent-limits');
    els.parentLimitHint = $('parent-limit-hint');
    els.parentAges = $('parent-ages');
    els.parentAgeHint = $('parent-age-hint');
    els.parentReport = $('parent-report');
    els.parentBackIcon = $('parent-back-icon');

    els.nightArt = $('night-art');
    els.nightTitle = $('night-title');
    els.nightMeta = $('night-meta');
    els.nightRange = $('night-range');
    els.nightElapsed = $('night-elapsed');
    els.nightTotal = $('night-total');
    els.nightPlayBtn = $('night-play-btn');
    els.nightPlayIcon = $('night-play-icon');
    els.nightTimerNote = $('night-timer-note');
    els.nightNote = $('night-note');
    els.nightBackIcon = $('night-back-icon');
    els.nightDayIcon = $('night-day-icon');

    els.profileDialog = $('profile-dialog');
    els.profileForm = $('profile-form');
    els.profileName = $('profile-name');
    els.profileAge = $('profile-age');
    els.profileNameError = $('profile-name-error');
    els.profileNameErrorIcon = $('profile-name-error-icon');
    els.profileNameErrorText = $('profile-name-error-text');
    els.exitDialog = $('exit-dialog');
  }

  function startClock() {
    function paint() {
      var d = new Date();
      var h = d.getHours();
      var m = d.getMinutes();
      els.statusTime.textContent = h + ':' + (m < 10 ? '0' + m : m);
    }
    paint();
    window.setInterval(paint, 20000);
  }

  function init() {
    cacheElements();
    renderSplash();
    renderStaticIcons();
    renderKeypad();
    renderTimerChips();
    startClock();

    var tonight = tonightPick();
    state.player.id = tonight.id;
    state.player.pos = state.progress[tonight.id] || 0;
    state.queue = STORIES.map(function (s) { return s.id; });

    applyNight();
    renderAll();
    bindEvents();

    var parsed = parseHash();
    if (parsed && parsed.route !== 'launch') {
      applyRoute(parsed.route, parsed.param, { fromHash: true });
    } else {
      applyRoute('launch', null, { fromHash: true });
      window.setTimeout(function () {
        if (state.route === 'launch') {
          state.splashDone = true;
          applyRoute('home', null);
        }
      }, 1800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

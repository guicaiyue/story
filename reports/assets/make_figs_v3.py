#!/usr/bin/env python3
"""生成《业务流程与双形态》报告的插图（PIL，无 graphviz）。

图 1：三段式 —— 行业标准形态 vs 本项目现状，标出四处断点。
图 2：目标数据模型 —— 家庭/设备/孩子/指派/作品/资产 的关系。
"""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"
FONT_B = "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc"

INK = (44, 62, 80)
INK2 = (90, 105, 120)
INK3 = (140, 152, 164)
DEEP = (26, 82, 118)
GREEN = (30, 132, 73)
RED = (176, 58, 58)
AMBER = (168, 120, 20)
BG = (250, 248, 244)
CARD = (255, 255, 255)
LINE = (216, 210, 200)


def f(size, bold=False):
    return ImageFont.truetype(FONT_B if bold else FONT, size)


def tw(d, text, font):
    b = d.textbbox((0, 0), text, font=font)
    return b[2] - b[0]


def wrap(d, text, font, width):
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if tw(d, cur + ch, font) > width and cur:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def para(d, xy, text, font, width, fill=INK, lh=1.55):
    x, y = xy
    h = int(font.size * lh)
    for ln in wrap(d, text, font, width):
        d.text((x, y), ln, font=font, fill=fill)
        y += h
    return y


def fig1():
    W, H = 1180, 1010
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, W, 76], fill=(240, 234, 224))
    d.text((44, 22), "业务模型：行业标准形态 与 本项目现状", font=f(28, True), fill=DEEP)

    # 两栏标题
    col_l, col_r = 44, 640
    cw = 480
    d.text((col_l, 96), "行业标准形态", font=f(23, True), fill=GREEN)
    d.text((col_l, 128), "喜马拉雅儿童 / YouTube Kids / 未成年人模式指南", font=f(16), fill=INK2)
    d.text((col_r, 96), "本项目现状", font=f(23, True), fill=RED)
    d.text((col_r, 128), "apps/server · apps/admin · apps/app（2026-11-15 实测）", font=f(16), fill=INK2)

    rows = [
        (
            "① 生产",
            "后台把音频、封面、视频做好再上传：\n上传 → 转码 → 质检 → 审核 → 上架。\n成品是资产，请求路径只发字节。",
            "后台只有两个文本框（coverUrl / audioUrl）。\n全仓无上传控件、无 multipart、无资产表。\n音频只能在播放请求里现合成。",
            "生产段不存在",
        ),
        (
            "② 编排",
            "家长从全库挑内容，指派给孩子或某台平板；\n可设时长、时段、年龄档、内容清单。\n设置存在服务端，多设备生效。",
            "Setting 只有 4 个标量：时长/定时/年龄档/门。\n没有“给这个孩子看哪些故事”的模型。\n标签字段存在，2197 条全空。",
            "编排段只有一个标量",
        ),
        (
            "③ 消费",
            "幼儿设备只看被指派的内容（儿童模式）；\n家长手机切到家长模式做管理。\n同一账号、多台设备、同一份数据。",
            "单形态 UI：首页/分类/我的，家长中心是隐藏页。\n每装一次生成一个新游客账号，deviceId 被丢弃。\n平板与手机互不相识。",
            "消费段单形态 + 匿名",
        ),
    ]

    y = 172
    for i, (badge, left, right, brk) in enumerate(rows):
        h = 196
        # 左卡
        d.rounded_rectangle([col_l, y, col_l + cw, y + h - 18], 10, fill=CARD, outline=(210, 226, 214))
        d.text((col_l + 20, y + 16), badge, font=f(20, True), fill=GREEN)
        para(d, (col_l + 20, y + 56), left, f(17), cw - 40, INK, 1.62)
        # 右卡
        d.rounded_rectangle([col_r, y, col_r + cw, y + h - 18], 10, fill=CARD, outline=(232, 208, 208))
        d.text((col_r + 20, y + 16), badge, font=f(20, True), fill=RED)
        para(d, (col_r + 20, y + 56), right, f(17), cw - 40, INK, 1.62)
        y += h

    # 断点标注（右侧竖标）
    for i, (_, _, _, brk) in enumerate(rows):
        yy = 172 + i * 196 + 150
        d.line([col_r - 108, yy, col_r - 14, yy], fill=RED, width=3)
        d.text((col_r - 104, yy - 32), "断", font=f(19, True), fill=RED)

    # 底部结论
    by = 172 + 3 * 196 + 8
    d.rounded_rectangle([44, by, W - 44, by + 96], 10, fill=(255, 253, 246), outline=(226, 214, 186))
    d.text((68, by + 16), "缺口不是“音频坏了”，是三段里有两段没有对应的软件实体", font=f(21, True), fill=AMBER)
    d.text((68, by + 56), "制作端缺失 → 运行时被迫兼任生产者；编排端缺失 → 家长只能改一个全局年龄档；"
                          "设备端缺失 → 两台设备是两个陌生人。", font=f(16), fill=INK2)

    img.save("/home/xirizhi/Projects/story/reports/assets/fig3-three-stages.png")
    print("fig3 ok", img.size)


def box(d, x, y, w, h, title, lines, color=DEEP, fill=CARD):
    d.rounded_rectangle([x, y, x + w, y + h], 8, fill=fill, outline=color, width=2)
    d.text((x + 14, y + 12), title, font=f(18, True), fill=color)
    yy = y + 44
    for ln in lines:
        d.text((x + 14, yy), ln, font=f(15), fill=INK2)
        yy += 26


def arrow(d, x1, y1, x2, y2, color=DEEP, label=None, lx=0, ly=0):
    d.line([x1, y1, x2, y2], fill=color, width=2)
    # 箭头
    if abs(x2 - x1) > abs(y2 - y1):
        s = 1 if x2 > x1 else -1
        d.polygon([(x2, y2), (x2 - 9 * s, y2 - 5), (x2 - 9 * s, y2 + 5)], fill=color)
    else:
        s = 1 if y2 > y1 else -1
        d.polygon([(x2, y2), (x2 - 5, y2 - 9 * s), (x2 + 5, y2 - 9 * s)], fill=color)
    if label:
        d.text((lx, ly), label, font=f(14), fill=color)


def fig2():
    W, H = 1180, 720
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, W, 76], fill=(240, 234, 224))
    d.text((44, 22), "目标数据模型：谁属于谁，谁决定孩子能看什么", font=f(28, True), fill=DEEP)

    # 三联标题
    for x, t, c in ((60, "身份侧", DEEP), (460, "编排侧", GREEN), (860, "内容侧", AMBER)):
        d.text((x, 96), t, font=f(19, True), fill=c)

    CX1, CX2, CX3, BW = 60, 460, 860, 250

    box(d, CX1, 130, BW, 130, "Account（家长）",
        ["phone 唯一", "role: parent / admin", "一个家长一个账号"], DEEP)
    box(d, CX1, 300, BW, 130, "Family",
        ["账号的家庭空间", "多设备、多孩子挂这里", "指派也挂这里"], DEEP)
    box(d, CX1, 470, BW, 130, "Child",
        ["昵称 / 年龄档", "一个家庭可多个", "进度与收藏按 child 记"], DEEP)

    box(d, CX2, 130, BW, 150, "Assignment（指派）",
        ["child × 清单 / 单集", "生效时段 · 每日时长", "家长想让孩子看的，就是它"], GREEN)
    box(d, CX2, 320, BW, 130, "幼儿形态（平板）",
        ["只读：只列命中的内容", "没有设置入口", "退出需家长验证"], GREEN)
    box(d, CX2, 490, BW, 130, "家长形态（手机）",
        ["写：指派、时长、时段", "看：收听报告", "过门后进入，不是另一个 App"], RED)

    box(d, CX3, 130, BW, 130, "Work（作品）",
        ["故事 / 舞台剧 / 视频", "年龄档 · 标签 · 教什么", "上架状态"], AMBER)
    box(d, CX3, 300, BW, 130, "Asset（资产）",
        ["audio / video / cover", "storageKey + 时长 + 校验", "uploading → ready"], AMBER)
    box(d, CX3, 470, BW, 130, "PlayEvent",
        ["account + child + work", "start / pause / complete", "按 child 聚合出报告"], INK2)

    # 身份侧竖链
    arrow(d, CX1 + BW // 2, 260, CX1 + BW // 2, 300, label="1:1", lx=CX1 + BW // 2 + 10, ly=268)
    arrow(d, CX1 + BW // 2, 430, CX1 + BW // 2, 470, label="1:N", lx=CX1 + BW // 2 + 10, ly=438)

    # Child → Assignment（折线）
    cy = 470 + 40
    d.line([CX1 + BW, cy, 400, cy], fill=GREEN, width=2)
    d.line([400, cy, 400, 195], fill=GREEN, width=2)
    d.line([400, 195, CX2, 195], fill=GREEN, width=2)
    d.polygon([(CX2, 195), (CX2 - 9, 190), (CX2 - 9, 200)], fill=GREEN)
    d.text((CX1 + BW + 8, cy - 26), "家长指派", font=f(14), fill=GREEN)

    # 编排侧竖链
    arrow(d, CX2 + BW // 2, 280, CX2 + BW // 2, 320, color=GREEN,
          label="命中后才可见", lx=CX2 + BW // 2 + 10, ly=288)
    # 家长形态 → Assignment（走右侧水槽，向上）
    d.line([CX2 + BW, 555, 735, 555], fill=RED, width=2)
    d.line([735, 555, 735, 215], fill=RED, width=2)
    d.line([735, 215, CX2 + BW, 215], fill=RED, width=2)
    d.polygon([(CX2 + BW, 215), (CX2 + BW + 9, 210), (CX2 + BW + 9, 220)], fill=RED)
    d.text((742, 570), "写入指派", font=f(14), fill=RED)

    # 内容侧竖链
    arrow(d, CX3 + BW // 2, 260, CX3 + BW // 2, 300, label="1:N", lx=CX3 + BW // 2 + 10, ly=268)
    arrow(d, CX3 + BW // 2, 430, CX3 + BW // 2, 470, label="播放时产生", lx=CX3 + BW // 2 + 10, ly=438)

    # Assignment → PlayEvent
    d.line([CX2 + BW, 185, 800, 185], fill=INK3, width=2)
    d.line([800, 185, 800, 535], fill=INK3, width=2)
    d.line([800, 535, CX3, 535], fill=INK3, width=2)
    d.polygon([(CX3, 535), (CX3 - 9, 530), (CX3 - 9, 540)], fill=INK3)

    d.rounded_rectangle([44, 646, W - 44, 700], 8, fill=(255, 253, 246), outline=(226, 214, 186))
    d.text((66, 660), "一句话：家长在手机上改的是 Assignment；平板只读 Assignment；作品和资产是后台生产的，与设备无关。",
           font=f(16), fill=AMBER)

    img.save("/home/xirizhi/Projects/story/reports/assets/fig4-data-model.png")
    print("fig4 ok", img.size)


if __name__ == "__main__":
    fig1()
    fig2()

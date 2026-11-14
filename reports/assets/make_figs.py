#!/usr/bin/env python3
"""生成报告用的两张架构图（PIL 绘制，2x 超采样，中文字体 Noto Sans CJK）。

字号按「图片最终以 170mm 宽印在 A4 上」反推：图片 1180px ↔ 170mm，
即 1px ≈ 0.408pt；要让正文落在 8pt 以上，图内字号需 ≥ 20px。
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

OUT = Path(__file__).resolve().parent
FONT_R = "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"
FONT_M = "/usr/share/fonts/noto-cjk/NotoSansCJK-Medium.ttc"
FONT_B = "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc"

NAVY = (26, 82, 118)
GREEN = (30, 132, 73)
BLUE = (46, 134, 193)
PURPLE = (91, 44, 111)
ORANGE = (200, 120, 55)
GREY = (108, 116, 124)
LIGHT = (244, 246, 248)
RED = (176, 58, 58)
S = 2


def F(size, bold=False, medium=False):
    path = FONT_B if bold else (FONT_M if medium else FONT_R)
    return ImageFont.truetype(path, int(size * S))


def rbox(d, x, y, w, h, fill, outline, r=12, width=2):
    d.rounded_rectangle([x * S, y * S, (x + w) * S, (y + h) * S],
                        radius=r * S, fill=fill, outline=outline, width=width * S)


def txt(d, x, y, s, f, fill):
    d.text((x * S, y * S), s, font=f, fill=fill)


def arrow(d, x1, y1, x2, y2, color=GREY, width=2, head=9):
    d.line([x1 * S, y1 * S, x2 * S, y2 * S], fill=color, width=width * S)
    ang = math.atan2(y2 - y1, x2 - x1)
    for s in (-0.42, 0.42):
        d.line([x2 * S, y2 * S,
                (x2 - head * math.cos(ang + s)) * S,
                (y2 - head * math.sin(ang + s)) * S], fill=color, width=width * S)


# ------------------------------------------------------------------ 图 1
def fig1():
    W, H = 1180, 1010
    img = Image.new("RGB", (W * S, H * S), "white")
    d = ImageDraw.Draw(img)

    f_h = F(30, bold=True)
    f_sub = F(21)
    f_box = F(23, medium=True)
    f_body = F(21)
    f_note_h = F(23, bold=True)
    f_note = F(20)

    txt(d, 34, 26, "图 1　现状：一次「取音频」请求里发生了什么", f_h, NAVY)
    txt(d, 34, 66, "缓存未命中：2 次 DB 读 ＋ 2 次 DB 写 ＋ 1 次最长 30 秒的外部调用 ＋ 全文件读盘", f_sub, GREY)

    steps = [
        ("App", "GET /api/stories/8/audio　Range: bytes=0-", LIGHT, GREY, NAVY),
        ("Fastify onRequest", "验 Bearer；公开内容允许匿名", LIGHT, GREY, NAVY),
        ("查 story_content", "DB 读 ①　只允许 status=published", LIGHT, BLUE, BLUE),
        ("查 audio_cache", "DB 读 ②　命中则直接走文件", LIGHT, BLUE, BLUE),
        ("未命中：TTS 分块合成", "外部 HTTP 7–30 秒 → 临时文件 → rename", (255, 245, 236), ORANGE, (150, 85, 30)),
        ("写回：upsert ＋ backfillStory", "DB 写 ③④　每次请求都会发生", (255, 241, 241), RED, RED),
        ("stat ＋ createReadStream", "Node 逐块发字节，Range 自己算", LIGHT, GREY, NAVY),
    ]

    x, w, h, gap = 34, 720, 92, 30
    y = 108
    for label, body, fill, border, ink in steps:
        rbox(d, x, y, w, h, fill, border)
        txt(d, x + 22, y + 14, label, f_box, ink)
        txt(d, x + 22, y + 50, body, f_body, GREY)
        y += h + gap
    yy = 108 + h
    for _ in range(len(steps) - 1):
        arrow(d, x + 46, yy + 4, x + 46, yy + gap - 4)
        yy += h + gap

    bx, bw = 800, 344
    rbox(d, bx, 108, bw, 300, (255, 251, 246), ORANGE)
    txt(d, bx + 20, 128, "为什么这是形状问题", f_note_h, ORANGE)
    for i, ln in enumerate([
        "播放器播 10 分钟的故事，",
        "会发 5–20 个 Range 请求",
        "",
        "每个请求重走整条链",
        "（命中缓存仍要 2 次 DB 写）",
        "",
        "长故事首次 7–30 秒，",
        "而 App 拉流超时是 8 秒",
    ]):
        txt(d, bx + 20, 172 + i * 28, ln, f_note, (120, 78, 48))

    rbox(d, bx, 432, bw, 210, (244, 248, 251), NAVY)
    txt(d, bx + 20, 452, "三个数字", f_note_h, NAVY)
    for i, ln in enumerate([
        "上游单次上限 ≈2,700 字",
        "12.4% 的故事需要分块",
        "块间 400ms 防限流",
    ]):
        txt(d, bx + 20, 496 + i * 34, ln, f_note, (60, 70, 80))

    rbox(d, bx, 660, bw, 220, (244, 250, 246), GREEN)
    txt(d, bx + 20, 678, "结论", f_note_h, GREEN)
    for i, ln in enumerate(["长任务不该住在", "短请求里。", "", "要搬的是合成，", "不是优化函数。"]):
        txt(d, bx + 20, 722 + i * 29, ln, f_note, (30, 90, 60))

    img.resize((W, H), Image.LANCZOS).save(OUT / "fig1-audio-request.png", optimize=True)
    print("fig1 ok")


# ------------------------------------------------------------------ 图 2
def fig2():
    W, H = 1180, 846
    img = Image.new("RGB", (W * S, H * S), "white")
    d = ImageDraw.Draw(img)

    f_h = F(29, bold=True)
    f_sub = F(20)
    f_box = F(22, medium=True)
    f_body = F(19)
    f_tag = F(18)

    txt(d, 34, 26, "图 2　目标拓扑：只多一个 worker 进程和一个 nginx internal location", f_h, NAVY)
    txt(d, 34, 64, "队列用现有 Postgres（pg-boss），字节交给 nginx，Node 只做鉴权与入队", f_sub, GREY)

    rbox(d, 300, 100, 580, 78, (240, 246, 250), NAVY)
    txt(d, 322, 114, "Traefik（已有）", f_box, NAVY)
    txt(d, 322, 148, "TLS 终止 · *.xirizhi.cn 路由 · HTTP→HTTPS", f_body, GREY)

    d.line([590 * S, 178 * S, 590 * S, 204 * S], fill=GREY, width=2 * S)
    d.line([290 * S, 204 * S, 890 * S, 204 * S], fill=GREY, width=2 * S)
    arrow(d, 290, 204, 290, 226)
    arrow(d, 890, 204, 890, 226)

    rbox(d, 40, 228, 500, 100, (245, 250, 246), GREEN)
    txt(d, 60, 242, "admin（nginx，已有）", f_box, GREEN)
    txt(d, 60, 276, "静态产物 · 安全头", f_body, GREY)
    txt(d, 60, 302, "/api/ 反代到 server:3000", f_body, GREY)

    rbox(d, 640, 228, 500, 100, (240, 246, 250), BLUE)
    txt(d, 660, 242, "server（Fastify，已有）", f_box, BLUE)
    txt(d, 660, 276, "REST · 鉴权 · 只读查询", f_body, GREY)
    txt(d, 660, 302, "命中音频只回一个响应头", f_body, GREY)

    arrow(d, 290, 328, 290, 352)
    arrow(d, 890, 328, 890, 352)

    rbox(d, 40, 354, 500, 108, (255, 250, 244), ORANGE)
    txt(d, 60, 368, "/_audio/ { internal; }", f_box, (150, 85, 30))
    txt(d, 60, 402, "nginx 自己发文件、算 Range", f_body, GREY)
    txt(d, 60, 428, "Node 参与：从读 30 秒文件 → 一个头", f_body, GREY)

    rbox(d, 640, 354, 500, 108, (246, 243, 251), PURPLE)
    txt(d, 660, 368, "pg-boss 入队（表在现有库）", f_box, PURPLE)
    txt(d, 660, 402, "singletonKey = storyId：只合成一次", f_body, GREY)
    txt(d, 660, 428, "未就绪回 202 → App 退避轮询", f_body, GREY)

    rbox(d, 40, 506, 500, 104, LIGHT, GREY)
    txt(d, 60, 520, "卷 /data/audio（已有）", f_box, (68, 76, 84))
    txt(d, 60, 554, "server 只读 · worker 读写", f_body, GREY)
    txt(d, 60, 580, "索引在库里、字节在盘上", f_body, GREY)

    rbox(d, 640, 506, 500, 104, (246, 243, 251), PURPLE)
    txt(d, 660, 520, "worker（同镜像，command=worker）", f_box, PURPLE)
    txt(d, 660, 554, "消费任务 → 合成 → 落盘 → 回填", f_body, GREY)
    txt(d, 660, 580, "顺带：日聚合 / 清理 / 分区维护", f_body, GREY)

    arrow(d, 290, 506, 290, 466, color=ORANGE)
    txt(d, 300, 478, "读", f_tag, ORANGE)
    d.line([640 * S, 558 * S, 560 * S, 558 * S], fill=GREY, width=2 * S)
    arrow(d, 600, 558, 542, 558)
    txt(d, 566, 532, "写", f_tag, GREY)

    arrow(d, 890, 610, 890, 638)
    arrow(d, 290, 610, 290, 638)

    rbox(d, 40, 640, 1100, 146, (240, 246, 250), NAVY)
    txt(d, 62, 654, "Postgres（一个库、两个 schema，已有）", f_box, NAVY)
    txt(d, 62, 690, "public：legacy 三表（只读为主）", f_body, GREY)
    txt(d, 62, 718, "app：账号 / 儿童 / 进度 / 收藏 / 播放 / 审计 / 音频索引 / 队列 / 日聚合", f_body, GREY)
    txt(d, 62, 744, "连接池由 @prisma/adapter-pg 托管：server 与 worker 各一个池", f_body, GREY)

    txt(d, 40, 806, "新增：橙＝nginx 规则　紫＝worker 与队列　其余均为现有组件重排", f_tag, (78, 86, 94))

    img.resize((W, H), Image.LANCZOS).save(OUT / "fig2-target-topology.png", optimize=True)
    print("fig2 ok")


if __name__ == "__main__":
    fig1()
    fig2()

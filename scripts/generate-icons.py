#!/usr/bin/env python3
import os
import subprocess
import shutil
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
TILE_INSET = 88
TILE_SIZE = SIZE - TILE_INSET * 2
RADIUS = round(TILE_SIZE * 0.225)

os.makedirs('build/icons', exist_ok=True)

# 1. 创建符合 macOS 现代图标标准的底板
tile = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(tile)

# 渐变背景：深邃微冷钛黑 (#18181b -> #09090b)
for y in range(TILE_SIZE):
    ratio = y / (TILE_SIZE - 1)
    r = int(24 + (9 - 24) * ratio)
    g = int(24 + (9 - 24) * ratio)
    b = int(27 + (11 - 27) * ratio)
    draw.line([(0, y), (TILE_SIZE, y)], fill=(r, g, b, 255))

# 绘制 openLoop 几何象征图形 (双闭环流动连接 / 编排循环)
cx, cy = TILE_SIZE // 2, TILE_SIZE // 2

# 外圈微柔和光晕
glow = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse([cx - 210, cy - 210, cx + 210, cy + 210], fill=(79, 70, 229, 60))
glow = glow.filter(ImageFilter.GaussianBlur(radius=50))
tile.alpha_composite(glow)

# 绘制内环与闭环多边形节点 (编排连接感)
shape_layer = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
sdraw = ImageDraw.Draw(shape_layer)

# 循环闭环轮廓 (Loop Track)
line_width = 44
loop_color = (244, 244, 246, 245)
accent_color = (99, 102, 241, 255) # Indigo-500

# 绘制左圆环与右圆环组成的无限循环 (Infinity / Open Loop)
r_ring = 140
left_center = (cx - 100, cy)
right_center = (cx + 100, cy)

sdraw.ellipse([left_center[0] - r_ring, left_center[1] - r_ring,
               left_center[0] + r_ring, left_center[1] + r_ring],
              outline=(228, 228, 231, 230), width=line_width)

sdraw.ellipse([right_center[0] - r_ring, right_center[1] - r_ring,
               right_center[0] + r_ring, right_center[1] + r_ring],
              outline=(99, 102, 241, 240), width=line_width)

# 核心节点光点 (Node points)
pts = [
    (cx - 240, cy),
    (cx, cy),
    (cx + 240, cy),
    (cx - 100, cy - 140),
    (cx + 100, cy + 140)
]
for px, py in pts:
    sdraw.ellipse([px - 22, py - 22, px + 22, py + 22], fill=(255, 255, 255, 255))
    sdraw.ellipse([px - 14, py - 14, px + 14, py + 14], fill=(79, 70, 229, 255))

tile.alpha_composite(shape_layer)

# 2. 制作圆角遮罩 (macOS Squircle mask)
mask = Image.new('L', (TILE_SIZE, TILE_SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([(0, 0), (TILE_SIZE - 1, TILE_SIZE - 1)], radius=RADIUS, fill=255)

# 微弱边缘内高光
border_overlay = Image.new('RGBA', (TILE_SIZE, TILE_SIZE), (0, 0, 0, 0))
bdraw = ImageDraw.Draw(border_overlay)
bdraw.rounded_rectangle([(1, 1), (TILE_SIZE - 2, TILE_SIZE - 2)], radius=RADIUS, outline=(255, 255, 255, 35), width=2)
tile.alpha_composite(border_overlay)

# 3. 合成至 1024x1024 画布
canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
canvas.paste(tile, (TILE_INSET, TILE_INSET), mask)
canvas.save('build/icon.png', optimize=True)
print('[icon] wrote build/icon.png')

# 4. 生成标准 macOS .icns 文件
iconset_dir = 'build/icons/icon.iconset'
if os.path.exists(iconset_dir):
    shutil.rmtree(iconset_dir)
os.makedirs(iconset_dir, exist_ok=True)

sizes = [16, 32, 64, 128, 256, 512]
for s in sizes:
    r = canvas.resize((s, s), Image.LANCZOS)
    r.save(f'{iconset_dir}/icon_{s}x{s}.png')
    r2 = canvas.resize((s * 2, s * 2), Image.LANCZOS)
    r2.save(f'{iconset_dir}/icon_{s}x{s}@2x.png')

subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', 'build/icons/icon.icns'], check=True)
shutil.rmtree(iconset_dir)
print('[icon] wrote build/icons/icon.icns')

#!/usr/bin/env python3
"""把 build/icon.svg（openLoop 猫头鹰图标）导出为桌面端图标资源。

产物：
- build/icon.png           1024×1024 主图标（electron-builder 引用）
- build/icons/icon.icns    macOS 图标包

SVG 是唯一图形来源。优先使用 rsvg-convert 渲染；没有则回退到 macOS 的 qlmanage。

注意：build/icon.svg 必须是满画布（rect 覆盖 0..1024），不要内缩圆角底板。
qlmanage 回退方案会把透明区域渲染成不透明白色，内缩底板会在 Dock 上露出一圈白边。
"""

import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_PATH = os.path.join(ROOT, 'build', 'icon.svg')
CANVAS = 1024
ICONSET_SIZES = [16, 32, 64, 128, 256, 512]


def render_svg(svg_path: str, size: int, out_path: str) -> None:
    """把 SVG 渲染为指定边长的 PNG。"""
    if shutil.which('rsvg-convert'):
        subprocess.run(
            ['rsvg-convert', '-w', str(size), '-h', str(size), '-o', out_path, svg_path],
            check=True,
        )
        return

    if shutil.which('qlmanage'):
        tmp_dir = tempfile.mkdtemp()
        try:
            subprocess.run(
                ['qlmanage', '-t', '-s', str(size), '-o', tmp_dir, svg_path],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            produced = os.path.join(tmp_dir, os.path.basename(svg_path) + '.png')
            shutil.copyfile(produced, out_path)
        finally:
            shutil.rmtree(tmp_dir)
        return

    sys.exit('[icon] 缺少 SVG 渲染工具：请安装 librsvg (rsvg-convert) 或在 macOS 上运行')


def main() -> None:
    os.makedirs(os.path.join(ROOT, 'build', 'icons'), exist_ok=True)
    master_path = os.path.join(ROOT, 'build', 'icon.master.png')

    render_svg(SVG_PATH, CANVAS, master_path)
    canvas = Image.open(master_path).convert('RGBA')
    if canvas.size != (CANVAS, CANVAS):
        canvas = canvas.resize((CANVAS, CANVAS), Image.LANCZOS)
    os.remove(master_path)

    canvas.save(os.path.join(ROOT, 'build', 'icon.png'), optimize=True)
    print('[icon] wrote build/icon.png')

    iconset_dir = os.path.join(ROOT, 'build', 'icons', 'icon.iconset')
    if os.path.exists(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir, exist_ok=True)

    for s in ICONSET_SIZES:
        canvas.resize((s, s), Image.LANCZOS).save(f'{iconset_dir}/icon_{s}x{s}.png')
        canvas.resize((s * 2, s * 2), Image.LANCZOS).save(f'{iconset_dir}/icon_{s}x{s}@2x.png')

    subprocess.run(
        ['iconutil', '-c', 'icns', iconset_dir, '-o', os.path.join(ROOT, 'build', 'icons', 'icon.icns')],
        check=True,
    )
    shutil.rmtree(iconset_dir)
    print('[icon] wrote build/icons/icon.icns')


if __name__ == '__main__':
    main()

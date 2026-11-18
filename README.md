
# X3 PDF Converter

**Convert PDF documents into XTC / XTCH files for the Xteink X3 e-reader.**

一个面向 Xteink X3 墨水屏阅读器的 PDF 转换工具，可将 PDF 文档转换为 XTC 或 XTCH 文件。

## Online Tool

使用 GitHub Pages 在线运行，无需安装软件：

https://zukuxi.github.io/test2/

## Features / 功能

### 1. Two conversion modes / 两种转换方式

**Original Mode / 原样转换**

- 保留 PDF 原有页面内容。
- 自动检测并裁切白边。
- 支持普通、积极和关闭白边处理。
- 支持自定义额外白边裁切距离，单位为 px。
- 页面内容按三等分方式生成 X3 页面。
- 适合漫画、扫描文档和固定版式 PDF。

**Reflow Mode / 重新排版**

- 尝试提取 PDF 中的文字内容。
- 将文字重新排列到 X3 页面中。
- 自动换行并生成新的页面。
- 图表、表格线条、公式图形等区域会尝试识别为局部图片，并嵌入重新排版后的文字流。
- 图片块使用原页面对应区域的完整栅格内容，因此会保留区域内的文字、符号和表格单元格内容。
- 扫描页面没有可提取文字层时，才会回退到原样转换。
- 多栏排版及边界不明显的复杂图文仍可能需要人工检查。

### 2. Page orientation / 页面方向

支持两种输出尺寸：

| Orientation | Output size |
|---|---:|
| Portrait / 竖屏 | 528 × 792 |
| Landscape / 横屏 | 792 × 528 |

页面预览与所选输出尺寸保持一致。

### 3. Output formats / 输出格式

- **XTC** — 1-bit monochrome
- **XTCH** — 2-bit grayscale

### 4. Image processing / 图像处理

- White border trimming / 白边裁切
- Custom trimming distance / 自定义裁切距离
- Atkinson dithering
- Floyd–Steinberg dithering
- Sierra Lite dithering
- Ordered dithering
- No dithering / 不使用抖动
- Contrast adjustment / 对比度调整
- Brightness adjustment / 亮度调整

### 5. Preview / 预览

- Preview up to 10 output pages.
- Preview uses the selected page dimensions.
- Preview shows the generated output pages rather than approximate cutting guides.

支持预览前 10 张最终输出页面，而不是仅显示原 PDF 的裁切示意图。

### 6. Local processing / 本地处理

- PDF files are processed locally in your browser.
- Files are not uploaded to a server.
- Each PDF is converted into an individual XTC / XTCH file.
- Temporary page canvases are released during processing to reduce memory usage.

所有 PDF 均在浏览器本地处理，不需要上传到服务器。

## How to Use / 使用方法

1. Open the online converter.
2. Select one or more PDF files.
3. Choose Original Mode or Reflow Mode.
4. Select Portrait or Landscape.
5. Configure output format and image processing options.
6. Generate a preview.
7. Start conversion.
8. Import the generated XTC / XTCH files into your Xteink X3.

使用步骤：

1. 打开在线转换器。
2. 选择一个或多个 PDF 文件。
3. 选择原样转换或重新排版。
4. 选择竖屏或横屏输出。
5. 设置输出格式及图像处理选项。
6. 生成预览。
7. 开始转换。
8. 将生成的 XTC / XTCH 文件导入 Xteink X3。

## Important Notes / 注意事项

- Reflow works best with PDFs containing selectable text.
- Scanned PDFs generally do not contain a usable text layer.
- Figure, table, and formula regions are detected as local image blocks and inserted into the reflowed text stream where possible.
- Crops are taken from the full rendered page so text and symbols inside those regions are retained.
- Only pages without an extractable text layer (such as scanned pages) fall back to original-page conversion.
- Multi-column layouts and graphics without clear boundaries may still need manual review.
- Large PDFs may require substantial browser memory.
- Conversion speed depends on the device, browser, PDF complexity, and rendering scale.

注意：

- 重新排版更适合包含可选中文字层的 PDF。
- 扫描版 PDF 通常没有可提取的文字层。
- 含有可提取文字层的页面优先进行文字重排；可识别的表格、公式和图形区域作为局部图片嵌入。
- 表格、公式及多栏排版的自动识别仍可能需要人工检查；未识别区域不会因此主动将整页回退为原样转换。
- 大型 PDF 可能占用较多浏览器内存。
- 转换速度取决于设备性能、浏览器、PDF 复杂程度及渲染清晰度。

## Technical Information / 技术信息

- JavaScript
- PDF.js
- HTML5 Canvas
- Browser-based processing
- GitHub Pages hosting

PDF rendering is powered by PDF.js.

## Privacy / 隐私

This tool processes documents locally in your browser. Your PDF files are not intentionally uploaded to a remote server.

本工具在浏览器本地处理 PDF，不会主动将你的文档上传到远程服务器。

## License / 许可证

This project is released under the MIT License.

## Acknowledgements / 致谢

- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF rendering library.
- [Xteink](https://xteink.com/) — X3 e-reader platform.

Thanks to the developers and contributors of the open-source projects that make this tool possible.

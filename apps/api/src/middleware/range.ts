/**
 * `Range: bytes=start-end` 解析（视频拖动进度条需要）。
 *
 * 只处理单区间请求——多区间（`bytes=0-99,200-299`）返回 undefined，
 * 调用方按整段返回即可（浏览器也能正常播放）。
 */
export function parseRange(
  rangeHeader: string | undefined,
  size: number | undefined,
): { start: number; end: number } | undefined {
  if (!rangeHeader || size === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return undefined;

  let start: number;
  let end: number;
  if (!rawStart) {
    // `bytes=-500`：最后 500 字节
    const suffix = Number.parseInt(rawEnd ?? '0', 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return undefined;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  if (start < 0) start = 0;
  if (end > size - 1) end = size - 1;
  if (start > end) return undefined;
  return { start, end };
}
